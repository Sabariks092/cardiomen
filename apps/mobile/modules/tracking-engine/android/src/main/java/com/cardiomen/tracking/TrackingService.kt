package com.cardiomen.tracking

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/** Keeps the process alive and feeds sensors into the engine. All logic lives in Engine. */
class TrackingService : Service(), Engine.ServiceHook, SensorEventListener {
  private lateinit var engine: Engine
  private lateinit var sensorThread: HandlerThread
  private lateinit var sensorHandler: Handler

  private var fused: FusedLocationProviderClient? = null
  private var platformLocation: LocationManager? = null
  private var subscribed = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var stopping = false

  private val fusedCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      result.locations.forEach(::handle)
    }
  }

  private val platformListener = LocationListener { handle(it) }

  // ACTION_SHUTDOWN can't be declared in the manifest, and isn't guaranteed to run. The checkpoint
  // recovers the session even if it doesn't.
  private val shutdownReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      engine.pause(PauseReason.DEVICE_SHUTDOWN)
    }
  }

  override fun onCreate() {
    super.onCreate()
    engine = Engine.get(this)
    sensorThread = HandlerThread("cardiomen-sensors").apply { start() }
    sensorHandler = Handler(sensorThread.looper)
    Notifier.ensureChannels(this)
    ContextCompat.registerReceiver(
      this,
      shutdownReceiver,
      IntentFilter(Intent.ACTION_SHUTDOWN),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    stopping = false
    val restartedByOs = intent == null
    try {
      goForeground()
    } catch (e: Exception) {
      // Android may refuse location for a service started without a visible app. That's fine:
      // the activity becomes a saved pause, and the notification tap brings the user back.
      if (restartedByOs) {
        engine.restartFailed(e.javaClass.simpleName)
      } else {
        engine.pause(PauseReason.UNKNOWN)
      }
      stopSelf()
      return START_NOT_STICKY
    }
    engine.attachService(this)

    if (restartedByOs) {
      if (!engine.continueAfterRestart()) engine.recover(Engine.TRIGGER_DEAD_MAN)
    } else {
      when (intent?.action) {
        ACTION_PAUSE -> engine.pause(PauseReason.USER)
        ACTION_RESUME -> engine.resume()
      }
    }

    val state = engine.currentSession()?.state
    if (state == null || (restartedByOs && state != SessionState.ACTIVE)) {
      stopTracking()
      return START_NOT_STICKY
    }
    ensureSensors()
    onEngineStateChanged()
    return START_STICKY
  }

  private fun goForeground() {
    val notification = Notifier.live(this, engine.currentSession(), engine.activeMs())
    val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
    ServiceCompat.startForeground(this, Notifier.ID_LIVE, notification, type)
  }

  @SuppressLint("MissingPermission")
  private fun ensureSensors() {
    if (subscribed) return
    subscribed = true

    val hasPlayServices = GoogleApiAvailability.getInstance()
      .isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS
    try {
      if (hasPlayServices) {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L)
          .setMinUpdateIntervalMillis(1_000L)
          .setMinUpdateDistanceMeters(0f)
          .setWaitForAccurateLocation(false)
          .build()
        fused = LocationServices.getFusedLocationProviderClient(this).also {
          it.requestLocationUpdates(request, fusedCallback, sensorThread.looper)
        }
      } else {
        platformLocation = getSystemService(LocationManager::class.java).also {
          it.requestLocationUpdates(
            LocationManager.GPS_PROVIDER,
            1_000L,
            0f,
            platformListener,
            sensorThread.looper,
          )
        }
      }
    } catch (e: SecurityException) {
      subscribed = false
      engine.pause(PauseReason.PERMISSION_REVOKED)
    }

    val sensors = getSystemService(SensorManager::class.java)
    sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)?.let {
      try {
        sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL, sensorHandler)
      } catch (e: SecurityException) {
        // No Physical Activity permission: steps stay empty and tracking carries on.
      }
    }
  }

  private fun handle(location: Location) {
    engine.onFix(
      Fix(
        tMs = location.time,
        lat = location.latitude,
        lng = location.longitude,
        accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
        altitudeM = if (location.hasAltitude()) location.altitude else null,
        speedMps = if (location.hasSpeed() && location.hasSpeedAccuracy()) location.speed.toDouble() else null,
      ),
    )
    if (engine.currentSession()?.state == SessionState.ARMED) engine.emitPreviewTick()
  }

  override fun onSensorChanged(event: SensorEvent) {
    engine.onStepCounter(event.values[0].toLong())
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  // ---------- Engine.ServiceHook ----------

  override fun onEngineStateChanged() {
    val session = engine.currentSession()
    // Auto-pause keeps listening, so it can resume by itself with the screen off.
    val autoPaused = session?.state == SessionState.PAUSED && session.pauseReason == PauseReason.AUTO
    updateWakeLock(session?.state == SessionState.ACTIVE || autoPaused)
    refreshNotification()
  }

  override fun refreshNotification() {
    if (stopping) return
    val session = engine.currentSession() ?: return
    try {
      getSystemService(NotificationManager::class.java)
        .notify(Notifier.ID_LIVE, Notifier.live(this, session, engine.activeMs()))
    } catch (e: SecurityException) {
      // Notifications denied. Tracking doesn't depend on them.
    }
  }

  override fun stopTracking() {
    if (stopping) return
    stopping = true
    removeSensors()
    updateWakeLock(false)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun removeSensors() {
    fused?.removeLocationUpdates(fusedCallback)
    platformLocation?.removeUpdates(platformListener)
    fused = null
    platformLocation = null
    getSystemService(SensorManager::class.java).unregisterListener(this)
    subscribed = false
  }

  @SuppressLint("WakelockTimeout")
  private fun updateWakeLock(hold: Boolean) {
    if (hold) {
      if (wakeLock?.isHeld == true) return
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cardiomen:tracking")
        .apply { acquire() }
    } else {
      wakeLock?.takeIf { it.isHeld }?.release()
      wakeLock = null
    }
  }

  override fun onDestroy() {
    removeSensors()
    updateWakeLock(false)
    unregisterReceiver(shutdownReceiver)
    engine.onServiceDestroyed(this)
    sensorThread.quitSafely()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_ENSURE = "com.cardiomen.tracking.ENSURE"
    const val ACTION_PAUSE = "com.cardiomen.tracking.PAUSE"
    const val ACTION_RESUME = "com.cardiomen.tracking.RESUME"

    fun ensureRunning(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, TrackingService::class.java).setAction(ACTION_ENSURE),
      )
    }
  }
}
