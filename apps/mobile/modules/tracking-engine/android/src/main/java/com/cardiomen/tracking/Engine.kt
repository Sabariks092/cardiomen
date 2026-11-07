package com.cardiomen.tracking

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import java.util.TimeZone
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask

/**
 * The recording itself. Everything runs on one thread, and every state change reaches disk before
 * it's acted on. Nothing here depends on JS, the network, login or the map.
 */
class Engine private constructor(context: Context) {
  private val app = context.applicationContext
  private val thread = HandlerThread("cardiomen-engine").apply { start() }
  private val handler = Handler(thread.looper)
  private val db = TrackingDb(app)

  private var session: Session? = null

  // True only while this process owns an open segment. A session stored as ACTIVE with this false
  // means the previous process died, which is exactly what recovery looks for.
  private var segmentOpen = false
  private var segmentStartElapsed = 0L
  private var bankedMs = 0L

  private val filter = GpsFilter()
  private var tally = StepTally()
  private val pace = PaceWindow()
  private val buffer = ArrayList<PointRow>()
  private var lastFix: Fix? = null
  private var lastFixElapsed = 0L
  private var lastAlarmElapsed = 0L
  private var lastNotificationElapsed = 0L
  private var ticksSinceFlush = 0

  private var service: ServiceHook? = null
  private val listeners = HashSet<Listener>()

  interface Listener {
    fun onState(snapshot: Map<String, Any?>)
    fun onTick(snapshot: Map<String, Any?>)
    fun onPoint(point: Map<String, Any?>)
  }

  /** What the engine needs from the running service. */
  interface ServiceHook {
    fun onEngineStateChanged()
    fun refreshNotification()
    fun stopTracking()
  }

  init {
    handler.post {
      session = db.loadOpenSession()
      db.purgeImportedBefore(System.currentTimeMillis() - RETENTION_MS)
    }
  }

  // ---------- Threading ----------

  private fun <T> call(block: () -> T): T {
    if (Looper.myLooper() == thread.looper) return block()
    val task = FutureTask(Callable { block() })
    handler.post(task)
    return try {
      task.get()
    } catch (e: ExecutionException) {
      throw e.cause ?: e
    }
  }

  // ---------- User commands (all idempotent) ----------

  /** The owner is the signed-in account, so a recording can never be imported into another one. */
  fun arm(type: String, ownerId: String): String = call {
    val open = session
    if (open != null) {
      if (open.state == SessionState.ARMED && open.type == type && open.ownerId == ownerId) return@call open.id
      throw IllegalStateException("UNFINISHED_SESSION")
    }
    val s = Session(
      id = UuidV7.generate(),
      ownerId = ownerId,
      type = type,
      state = SessionState.ARMED,
      tzOffsetMin = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000,
      bootCount = bootCount(),
      appVersion = appVersion(),
    )
    db.insertSession(s)
    session = s
    resetSegmentTools()
    tally = StepTally()
    buffer.clear()
    handler.removeCallbacks(armTimeout)
    handler.postDelayed(armTimeout, ARM_TIMEOUT_MS)
    emitState()
    s.id
  }

  fun cancelArm(): Unit = call {
    val s = session ?: return@call
    if (s.state != SessionState.ARMED) return@call
    handler.removeCallbacks(armTimeout)
    db.deleteSessionData(s.id)
    session = null
    service?.stopTracking()
    emitState()
  }

  fun begin(): Unit = call {
    val s = session ?: throw IllegalStateException("NO_SESSION")
    if (s.state == SessionState.ACTIVE) return@call
    check(Transitions.can(s.state, SessionState.ACTIVE)) { "BAD_STATE" }
    handler.removeCallbacks(armTimeout)
    s.startedAtWall = System.currentTimeMillis()
    openSegment(s, "begin")
    emitState()
  }

  fun pause(reason: String = PauseReason.USER): Unit = call {
    val s = session ?: return@call
    if (s.state != SessionState.ACTIVE) return@call
    closeSegment(s)
    s.state = SessionState.PAUSED
    s.pauseReason = reason
    s.lastWallMs = System.currentTimeMillis()
    flush(s, listOf("pause" to reason))
    cancelDeadMan()
    service?.onEngineStateChanged()
    handler.removeCallbacks(releaseService)
    handler.postDelayed(releaseService, PAUSE_RELEASE_MS)
    emitState()
  }

  fun resume(): Unit = call {
    val s = session ?: throw IllegalStateException("NO_SESSION")
    if (s.state == SessionState.ACTIVE) return@call
    check(Transitions.can(s.state, SessionState.ACTIVE)) { "BAD_STATE" }
    handler.removeCallbacks(releaseService)
    Notifier.cancelAlert(app)
    openSegment(s, "resume")
    emitState()
  }

  fun stop(): Unit = call {
    val s = session ?: return@call
    if (!Transitions.can(s.state, SessionState.FINISHED)) return@call
    if (segmentOpen) closeSegment(s)
    s.state = SessionState.FINISHED
    s.pauseReason = null
    s.finishedAtWall = System.currentTimeMillis()
    s.lastWallMs = s.finishedAtWall
    flush(s, listOf("stop" to null))
    cancelDeadMan()
    handler.removeCallbacks(releaseService)
    Notifier.cancelAlert(app)
    session = null
    service?.stopTracking()
    emitState()
  }

  fun discard(): Unit = call {
    val s = session ?: return@call
    check(Transitions.can(s.state, SessionState.DISCARDED) && s.state == SessionState.PAUSED) { "BAD_STATE" }
    handler.removeCallbacks(releaseService)
    buffer.clear()
    db.deleteSessionData(s.id)
    Notifier.cancelAlert(app)
    session = null
    service?.stopTracking()
    emitState()
  }

  fun ackImported(id: String): Unit = call {
    val s = db.loadSession(id) ?: return@call
    if (!Transitions.can(s.state, SessionState.IMPORTED)) return@call
    s.state = SessionState.IMPORTED
    s.importedAtWall = System.currentTimeMillis()
    db.commit(s, emptyList())
  }

  // ---------- Recovery ----------

  /**
   * Runs at app launch, boot, package replace and from the dead-man alarm. Safe to call any time:
   * an activity this process is really recording is left alone.
   */
  fun recover(trigger: String): Unit = call {
    val s = session ?: return@call
    when (s.state) {
      SessionState.ARMED -> if (service == null) {
        db.deleteSessionData(s.id)
        session = null
        emitState()
      }
      SessionState.ACTIVE -> if (!segmentOpen) {
        interrupt(s, trigger)
        Notifier.pausedAlert(app, s)
        emitState()
      }
      SessionState.PAUSED -> {
        // A reboot clears notifications, so remind the user a paused activity is waiting.
        if (trigger == TRIGGER_BOOT || trigger == TRIGGER_UPDATE) Notifier.pausedAlert(app, s)
      }
      else -> Unit
    }
  }

  /** The OS restarted a sticky service in a new process, and it's holding location again. */
  fun continueAfterRestart(): Boolean = call {
    val s = session ?: return@call false
    if (s.state != SessionState.ACTIVE) return@call false
    if (segmentOpen) return@call true
    if (s.bootCount != bootCount()) return@call false
    openSegment(s, "gap", "process_restart")
    emitState()
    true
  }

  /** The sticky restart couldn't regain location, so the activity becomes a saved pause. */
  fun restartFailed(detail: String): Unit = call {
    val s = session ?: return@call
    if (s.state == SessionState.ACTIVE && !segmentOpen) {
      interrupt(s, "restart_failed:$detail")
      Notifier.pausedAlert(app, s)
      emitState()
    }
  }

  /** The service went away while the process lives on (e.g. the user stopped it from the OS). */
  fun onServiceDestroyed(hook: ServiceHook): Unit = call {
    if (service === hook) service = null
    val s = session ?: return@call
    if (s.state == SessionState.ACTIVE) {
      pause(PauseReason.UNKNOWN)
      Notifier.pausedAlert(app, s)
    }
  }

  private fun interrupt(s: Session, trigger: String) {
    // active_ms was saved at the last checkpoint, so downtime is never counted, even across reboots.
    s.pauseReason = classify(s)
    s.state = SessionState.PAUSED
    s.bootCount = bootCount()
    s.appVersion = appVersion()
    db.commit(s, emptyList(), listOf("gap" to trigger, "pause" to s.pauseReason))
    cancelDeadMan()
  }

  private fun classify(s: Session): String = when {
    s.bootCount != bootCount() -> PauseReason.DEVICE_SHUTDOWN
    s.appVersion != appVersion() -> PauseReason.APP_UPDATED
    !hasLocationPermission() -> PauseReason.PERMISSION_REVOKED
    else -> PauseReason.PROCESS_KILLED
  }

  // ---------- Sensor input ----------

  fun onFix(fix: Fix) {
    handler.post {
      lastFix = fix
      lastFixElapsed = SystemClock.elapsedRealtime()
      val s = session ?: return@post
      if (s.state != SessionState.ACTIVE || !segmentOpen) return@post

      val result = filter.process(fix)
      s.distanceM += result.addedMeters
      pace.add(activeMsNow(s), s.distanceM)
      buffer.add(PointRow(s.nextPointSeq++, s.segmentNo, fix, result.accepted))
      emitPoint(s, fix, result.accepted)
    }
  }

  fun onStepCounter(value: Long) {
    handler.post {
      val s = session
      val active = s?.state == SessionState.ACTIVE && segmentOpen
      tally.onReading(value, active)
      if (s != null && active) s.steps = tally.total
    }
  }

  fun attachService(hook: ServiceHook): Unit = call { service = hook }

  // ---------- Reads ----------

  fun snapshot(): Map<String, Any?> = call { buildSnapshot() }
  fun listFinished(): List<Map<String, Any?>> = call { db.loadFinished().map(::summary) }
  fun points(id: String, afterSeq: Long, limit: Int): List<Map<String, Any?>> = call {
    session?.takeIf { it.id == id }?.let { flush(it) }
    db.loadPoints(id, afterSeq, limit).map(::pointMap)
  }
  fun events(limit: Int): List<Map<String, Any?>> = call { db.loadEvents(limit) }
  fun currentSession(): Session? = call { session?.copy() }
  fun activeMs(): Long = call { session?.let(::activeMsNow) ?: 0L }

  fun addListener(l: Listener): Boolean = call { listeners.add(l) }
  fun removeListener(l: Listener): Boolean = call { listeners.remove(l) }

  /** Lets the start screen show position and GPS strength before recording begins. */
  fun emitPreviewTick() {
    handler.post { emitTick() }
  }

  fun isIgnoringBatteryOptimizations() =
    app.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(app.packageName)

  // ---------- Internals ----------

  private fun openSegment(s: Session, eventKind: String, detail: String? = null) {
    s.segmentNo += 1
    s.state = SessionState.ACTIVE
    s.pauseReason = null
    s.bootCount = bootCount()
    s.appVersion = appVersion()
    s.lastWallMs = System.currentTimeMillis()
    bankedMs = s.activeMs
    segmentStartElapsed = SystemClock.elapsedRealtime()
    segmentOpen = true
    resetSegmentTools()
    tally.total = s.steps ?: tally.total
    tally.onSegmentStart()
    db.commit(s, emptyList(), listOf(eventKind to detail))
    armDeadMan(force = true)
    service?.onEngineStateChanged()
    handler.removeCallbacks(heartbeat)
    handler.postDelayed(heartbeat, TICK_MS)
  }

  private fun closeSegment(s: Session) {
    s.activeMs = activeMsNow(s)
    bankedMs = s.activeMs
    segmentOpen = false
    s.steps = tally.total
    handler.removeCallbacks(heartbeat)
  }

  private fun resetSegmentTools() {
    filter.reset()
    pace.reset()
  }

  private fun activeMsNow(s: Session): Long =
    if (segmentOpen) bankedMs + (SystemClock.elapsedRealtime() - segmentStartElapsed) else s.activeMs

  private fun flush(s: Session, events: List<Pair<String, String?>> = emptyList()) {
    if (segmentOpen) {
      s.activeMs = activeMsNow(s)
      s.lastWallMs = System.currentTimeMillis()
    }
    val pending = ArrayList(buffer)
    try {
      db.commit(s, pending, events)
      buffer.clear()
    } catch (e: Exception) {
      // E.g. a full disk. Points stay in memory and the next commit tries again.
      android.util.Log.e("CardiomenEngine", "commit failed", e)
    }
  }

  private val heartbeat: Runnable = object : Runnable {
    override fun run() {
      val s = session ?: return
      if (s.state != SessionState.ACTIVE || !segmentOpen) return
      ticksSinceFlush += 1
      if (ticksSinceFlush >= FLUSH_EVERY_TICKS) {
        ticksSinceFlush = 0
        flush(s)
      }
      armDeadMan(force = false)
      val now = SystemClock.elapsedRealtime()
      if (now - lastNotificationElapsed >= NOTIFICATION_MS) {
        lastNotificationElapsed = now
        service?.refreshNotification()
      }
      emitTick()
      handler.postDelayed(this, TICK_MS)
    }
  }

  private val armTimeout: Runnable = Runnable { cancelArm() }

  // A paused activity shouldn't hold GPS forever. It stays safe in the database either way.
  private val releaseService: Runnable = Runnable {
    val s = session
    if (s != null && s.state == SessionState.PAUSED) {
      service?.stopTracking()
      Notifier.pausedAlert(app, s)
    }
  }

  private fun armDeadMan(force: Boolean) {
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastAlarmElapsed < DEAD_MAN_REARM_MS) return
    lastAlarmElapsed = now
    app.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP,
      now + DEAD_MAN_FIRE_MS,
      deadManIntent(),
    )
  }

  private fun cancelDeadMan() {
    app.getSystemService(AlarmManager::class.java).cancel(deadManIntent())
  }

  private fun deadManIntent() = PendingIntent.getBroadcast(
    app,
    4,
    Intent(app, DeadManReceiver::class.java),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private fun gpsStatus(): String {
    val lm = app.getSystemService(LocationManager::class.java)
    if (!lm.isLocationEnabled) return "off"
    val fix = lastFix ?: return "searching"
    if (session == null) return "searching"
    if (SystemClock.elapsedRealtime() - lastFixElapsed > GPS_STALE_MS) return "searching"
    val accuracy = fix.accuracyM ?: return "weak"
    return if (accuracy <= GOOD_ACCURACY_M) "good" else "weak"
  }

  private fun buildSnapshot(): Map<String, Any?> {
    val s = session
    val fix = lastFix
    return mapOf(
      "sessionId" to s?.id,
      "type" to s?.type,
      "state" to (s?.state?.name ?: "IDLE"),
      "pauseReason" to s?.pauseReason,
      "activeMs" to (s?.let(::activeMsNow) ?: 0L).toDouble(),
      "startedAt" to s?.startedAtWall?.toDouble(),
      "lastWallMs" to s?.lastWallMs?.toDouble(),
      "distanceM" to (s?.distanceM ?: 0.0),
      "steps" to (if (s != null && segmentOpen) tally.total else s?.steps),
      "currentPaceSecPerKm" to pace.secPerKm(),
      "gps" to gpsStatus(),
      "lat" to fix?.lat,
      "lng" to fix?.lng,
      "accuracyM" to fix?.accuracyM,
      "health" to mapOf(
        "locationPermission" to hasLocationPermission(),
        "gpsEnabled" to app.getSystemService(LocationManager::class.java).isLocationEnabled,
        "ignoringBatteryOptimizations" to isIgnoringBatteryOptimizations(),
        "lowStorage" to (StatFs(app.filesDir.path).availableBytes < MIN_FREE_BYTES),
      ),
    )
  }

  private fun summary(s: Session): Map<String, Any?> = mapOf(
    "id" to s.id,
    "ownerId" to s.ownerId,
    "type" to s.type,
    "startedAt" to (s.startedAtWall ?: s.finishedAtWall ?: 0L).toDouble(),
    "endedAt" to (s.finishedAtWall ?: 0L).toDouble(),
    "tzOffsetMin" to s.tzOffsetMin,
    "activeMs" to s.activeMs.toDouble(),
    "distanceM" to s.distanceM,
    "steps" to s.steps,
    "engineVersion" to TrackingDb.ENGINE_VERSION,
    "pointCount" to s.nextPointSeq.toDouble(),
  )

  private fun pointMap(p: PointRow): Map<String, Any?> = mapOf(
    "seq" to p.seq.toDouble(),
    "segment" to p.segmentNo,
    "t" to p.fix.tMs.toDouble(),
    "lat" to p.fix.lat,
    "lng" to p.fix.lng,
    "acc" to p.fix.accuracyM,
    "alt" to p.fix.altitudeM,
    "ok" to p.accepted,
  )

  private fun emitState() {
    if (listeners.isEmpty()) return
    val snap = buildSnapshot()
    listeners.forEach { it.onState(snap) }
  }

  private fun emitTick() {
    if (listeners.isEmpty()) return
    val snap = buildSnapshot()
    listeners.forEach { it.onTick(snap) }
  }

  private fun emitPoint(s: Session, fix: Fix, accepted: Boolean) {
    if (listeners.isEmpty()) return
    val point = mapOf(
      "seq" to (s.nextPointSeq - 1).toDouble(),
      "segment" to s.segmentNo,
      "t" to fix.tMs.toDouble(),
      "lat" to fix.lat,
      "lng" to fix.lng,
      "acc" to fix.accuracyM,
      "ok" to accepted,
    )
    listeners.forEach { it.onPoint(point) }
  }

  private fun hasLocationPermission() = ContextCompat.checkSelfPermission(
    app,
    Manifest.permission.ACCESS_FINE_LOCATION,
  ) == PackageManager.PERMISSION_GRANTED

  private fun bootCount() =
    Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)

  private fun appVersion(): Long {
    val info = app.packageManager.getPackageInfo(app.packageName, 0)
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  }

  companion object {
    const val TRIGGER_LAUNCH = "launch"
    const val TRIGGER_BOOT = "boot"
    const val TRIGGER_UPDATE = "package_replaced"
    const val TRIGGER_DEAD_MAN = "dead_man"

    private const val TICK_MS = 1_000L
    private const val FLUSH_EVERY_TICKS = 3
    private const val NOTIFICATION_MS = 15_000L
    private const val DEAD_MAN_REARM_MS = 60_000L
    private const val DEAD_MAN_FIRE_MS = 180_000L
    private const val PAUSE_RELEASE_MS = 600_000L
    private const val ARM_TIMEOUT_MS = 900_000L
    private const val GPS_STALE_MS = 10_000L
    private const val GOOD_ACCURACY_M = 15.0
    private const val MIN_FREE_BYTES = 50L * 1024 * 1024
    private const val RETENTION_MS = 30L * 24 * 60 * 60 * 1000

    @Volatile private var instance: Engine? = null

    fun get(context: Context): Engine = instance ?: synchronized(this) {
      instance ?: Engine(context).also { instance = it }
    }
  }
}
