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
  // Last counted position before the process died. The first good fix after a restart is joined to it.
  private var bridgeFrom: Fix? = null
  private var lastFixElapsed = 0L
  private var lastAlarmElapsed = 0L
  private var lastNotificationElapsed = 0L
  private var ticksSinceFlush = 0

  private var coach = CoachConfig.load(app)
  private val milestones = MilestoneTracker()
  private val autoPause = AutoPauseDetector()
  private val voice = CoachVoice(app)

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
    milestones.reset()
    tally = StepTally()
    buffer.clear()
    if (coach.voice) voice.prepare()
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

  /** Voice, vibration and auto-pause settings. Stored, so they hold for background recordings. */
  fun setCoachConfig(config: CoachConfig): Unit = call {
    coach = config
    CoachConfig.save(app, config)
    if (config.voice) voice.prepare()
  }

  // ---------- Recovery ----------

  /**
   * Runs at app launch, boot, package replace and from the dead-man alarm. Safe to call any time:
   * an activity this process is really recording is left alone.
   *
   * A recording whose process died is restarted and carries on. It only becomes a saved pause when
   * that's impossible: a reboot, an app update, a long gap, or Android refusing the restart.
   */
  fun recover(trigger: String, allowRestart: Boolean = true): Unit = call {
    val s = session ?: return@call
    when (s.state) {
      SessionState.ARMED -> if (service == null) {
        db.deleteSessionData(s.id)
        session = null
        emitState()
      }
      SessionState.ACTIVE -> if (!segmentOpen) {
        val restartable = allowRestart && (trigger == TRIGGER_LAUNCH || trigger == TRIGGER_DEAD_MAN)
        if (restartable && canContinue(s) && startService()) {
          // If this restart dies silently too, the alarm tries again.
          armDeadMan(force = true)
          return@call
        }
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

  /**
   * The service is back in a new process and holding location again. The activity was never paused,
   * so the time the process was gone still counts, and the route is joined across it.
   */
  fun continueAfterRestart(): Boolean = call {
    val s = session ?: return@call false
    if (s.state != SessionState.ACTIVE) return@call false
    if (segmentOpen) return@call true
    if (!canContinue(s)) return@call false
    val gapMs = deadGapMs(s)
    s.activeMs += gapMs
    val from = db.loadLastAcceptedFix(s.id)
    openSegment(s, "gap", "process_restart:${gapMs / 1000}s", newSegment = false)
    bridgeFrom = from
    emitState()
    true
  }

  /** The restart couldn't regain location, so the activity becomes a saved pause. */
  fun restartFailed(detail: String): Unit = call {
    val s = session ?: return@call
    if (s.state != SessionState.ACTIVE) return@call
    if (segmentOpen) {
      pause(PauseReason.UNKNOWN)
    } else {
      interrupt(s, "restart_failed:$detail")
      emitState()
    }
    Notifier.pausedAlert(app, s)
  }

  /** The service went away while the process lives on. Start it again; pause only if that fails. */
  fun onServiceDestroyed(hook: ServiceHook): Unit = call {
    if (service === hook) service = null
    val s = session ?: return@call
    if (s.state == SessionState.ACTIVE && service == null && !startService()) {
      pause(PauseReason.UNKNOWN)
      Notifier.pausedAlert(app, s)
    }
  }

  /** The app was swiped away. Some phones kill the process with it, so check back in a moment. */
  fun onTaskRemoved() {
    handler.post {
      if (session?.state != SessionState.ACTIVE) return@post
      app.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + TASK_REMOVED_CHECK_MS,
        deadManIntent(REQUEST_TASK_REMOVED),
      )
    }
  }

  private fun startService(): Boolean = try {
    TrackingService.recoverRunning(app)
    true
  } catch (e: Exception) {
    // Android refuses a background start unless the app is exempt from battery optimization.
    android.util.Log.w("CardiomenEngine", "service restart refused", e)
    false
  }

  private fun deadGapMs(s: Session): Long =
    (System.currentTimeMillis() - (s.lastWallMs ?: System.currentTimeMillis())).coerceAtLeast(0L)

  private fun canContinue(s: Session): Boolean =
    s.bootCount == bootCount() &&
      s.appVersion == appVersion() &&
      hasLocationPermission() &&
      deadGapMs(s) <= MAX_CONTINUE_GAP_MS

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
      if (s.state == SessionState.PAUSED && s.pauseReason == PauseReason.AUTO && coach.autoPause) {
        if (!autoPause.shouldResume(fix)) return@post
        val anchor = autoPause.pausedAnchor()
        resume()
        // Count the few meters walked before the resume was certain.
        anchor?.let { filter.process(it) }
        cue("Resumed", longArrayOf(0, 60))
      }
      if (s.state != SessionState.ACTIVE || !segmentOpen) return@post

      val result = filter.process(fix)
      s.distanceM += result.addedMeters
      if (result.accepted) {
        bridgeFrom?.let { s.distanceM += bridgeMeters(it, fix) }
        bridgeFrom = null
      }
      pace.add(activeMsNow(s), s.distanceM)
      buffer.add(PointRow(s.nextPointSeq++, s.segmentNo, fix, result.accepted))
      emitPoint(s, fix, result.accepted)
      if (coach.autoPause) autoPause.onActiveFix(SystemClock.elapsedRealtime(), fix, s.distanceM)
      checkMilestone(s)
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

  private fun openSegment(s: Session, eventKind: String, detail: String? = null, newSegment: Boolean = true) {
    if (newSegment) s.segmentNo += 1
    s.state = SessionState.ACTIVE
    s.pauseReason = null
    s.bootCount = bootCount()
    s.appVersion = appVersion()
    s.lastWallMs = System.currentTimeMillis()
    bankedMs = s.activeMs
    segmentStartElapsed = SystemClock.elapsedRealtime()
    segmentOpen = true
    resetSegmentTools()
    autoPause.onSegmentStart(segmentStartElapsed, s.distanceM)
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
    bridgeFrom = null
    s.steps = tally.total
    handler.removeCallbacks(heartbeat)
  }

  private fun resetSegmentTools() {
    filter.reset()
    pace.reset()
    bridgeFrom = null
  }

  /** Straight-line distance across a restart, unless it implies an impossible speed. */
  private fun bridgeMeters(from: Fix, to: Fix): Double {
    val meters = haversineM(from.lat, from.lng, to.lat, to.lng)
    val seconds = (to.tMs - from.tMs) / 1000.0
    return if (meters >= MIN_BRIDGE_M && seconds > 0 && meters / seconds <= MAX_BRIDGE_SPEED_MPS) meters else 0.0
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
      if (coach.autoPause && autoPause.shouldPause(now, s.distanceM)) {
        pause(PauseReason.AUTO)
        cue("Auto paused", longArrayOf(0, 60, 80, 60))
        return
      }
      if (now - lastNotificationElapsed >= NOTIFICATION_MS) {
        lastNotificationElapsed = now
        service?.refreshNotification()
      }
      emitTick()
      handler.postDelayed(this, TICK_MS)
    }
  }

  private fun checkMilestone(s: Session) {
    if (!coach.voice && !coach.haptics) return
    val reached = milestones.check(s.id, s.distanceM, coach.intervalM) ?: return
    try {
      if (coach.haptics) voice.vibrate()
      if (coach.voice) {
        voice.speak(CoachVoice.milestoneText(reached, coach.intervalM, coach.unit, activeMsNow(s), s.distanceM))
      }
    } catch (e: Exception) {
      // Feedback is a nicety. It must never disturb the recording.
      android.util.Log.w("CardiomenEngine", "coach failed", e)
    }
  }

  private fun cue(text: String, pattern: LongArray) {
    try {
      if (coach.haptics) voice.vibrate(pattern)
      if (coach.voice) voice.speak(text)
    } catch (e: Exception) {
      android.util.Log.w("CardiomenEngine", "coach failed", e)
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
    val alarms = app.getSystemService(AlarmManager::class.java)
    alarms.cancel(deadManIntent())
    alarms.cancel(deadManIntent(REQUEST_TASK_REMOVED))
  }

  private fun deadManIntent(requestCode: Int = REQUEST_DEAD_MAN) = PendingIntent.getBroadcast(
    app,
    requestCode,
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
        "backgroundLocation" to hasBackgroundLocation(),
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

  // "Allow all the time". Without it Android won't let a restarted recorder use location.
  private fun hasBackgroundLocation() = Build.VERSION.SDK_INT < 29 ||
    ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
    PackageManager.PERMISSION_GRANTED

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
    private const val DEAD_MAN_REARM_MS = 20_000L
    private const val DEAD_MAN_FIRE_MS = 60_000L
    private const val TASK_REMOVED_CHECK_MS = 5_000L
    private const val REQUEST_DEAD_MAN = 4
    private const val REQUEST_TASK_REMOVED = 5
    // Longer than this without a recorder and it's no longer the same outing: save it as a pause.
    private const val MAX_CONTINUE_GAP_MS = 900_000L
    private const val MIN_BRIDGE_M = 5.0
    private const val MAX_BRIDGE_SPEED_MPS = 12.0
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
