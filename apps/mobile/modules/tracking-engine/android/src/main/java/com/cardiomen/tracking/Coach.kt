package com.cardiomen.tracking

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** What the user chose in Settings. Kept on disk so it applies even when the app UI isn't running. */
data class CoachConfig(
  val voice: Boolean = false,
  val haptics: Boolean = true,
  val autoPause: Boolean = false,
  val intervalM: Double = 1000.0,
  val unit: String = "km",
) {
  companion object {
    private const val PREFS = "cardigo_coach"

    fun load(context: Context): CoachConfig {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return CoachConfig(
        voice = p.getBoolean("voice", false),
        haptics = p.getBoolean("haptics", true),
        autoPause = p.getBoolean("autoPause", false),
        intervalM = p.getFloat("intervalM", 1000f).toDouble().coerceIn(200.0, 10_000.0),
        unit = p.getString("unit", "km") ?: "km",
      )
    }

    fun save(context: Context, c: CoachConfig) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean("voice", c.voice)
        .putBoolean("haptics", c.haptics)
        .putBoolean("autoPause", c.autoPause)
        .putFloat("intervalM", c.intervalM.toFloat())
        .putString("unit", c.unit)
        .apply()
    }
  }
}

/** Which distance milestones have been passed. Pure, so it's unit tested. */
class MilestoneTracker {
  private var sessionId: String? = null
  private var passed = 0L

  /** Returns the milestone number just crossed, or null. Never announces one twice. */
  fun check(sessionId: String, distanceM: Double, intervalM: Double): Long? {
    val reached = floor(distanceM / intervalM).toLong()
    if (sessionId != this.sessionId) {
      // A new session, or the process restarted mid-session: start from where it is now.
      this.sessionId = sessionId
      passed = if (distanceM < intervalM) 0 else reached
      return null
    }
    if (reached <= passed) return null
    passed = reached
    return reached
  }

  fun reset() {
    sessionId = null
    passed = 0
  }
}

/**
 * Auto-pause: pauses after standing still with a good GPS signal, and resumes once you clearly
 * move away. A lost signal (a tunnel, a building) never pauses, because nothing can tell that
 * apart from running on. Pure, so it's unit tested.
 */
class AutoPauseDetector(
  private val stillMs: Long = 15_000,
  private val warmUpMs: Long = 20_000,
  private val progressM: Double = 3.0,
  private val goodAccuracyM: Double = 20.0,
  private val movingSpeedMps: Double = 0.9,
  private val resumeDistanceM: Double = 15.0,
) {
  private var markDistance = 0.0
  private var markElapsed = 0L
  private var segmentStart = 0L
  private var lastGoodFixElapsed = Long.MIN_VALUE / 2
  private var anchor: Fix? = null

  fun onSegmentStart(nowElapsed: Long, distanceM: Double) {
    segmentStart = nowElapsed
    markElapsed = nowElapsed
    markDistance = distanceM
    anchor = null
  }

  /** Every fix while recording. */
  fun onActiveFix(nowElapsed: Long, fix: Fix, distanceM: Double) {
    val good = (fix.accuracyM ?: Double.MAX_VALUE) <= goodAccuracyM
    if (good) {
      lastGoodFixElapsed = nowElapsed
      anchor = fix
    }
    val moving = (fix.speedMps ?: 0.0) >= movingSpeedMps
    if (moving || distanceM - markDistance >= progressM) {
      markDistance = distanceM
      markElapsed = nowElapsed
    }
  }

  /** Once a second while recording. True means: pause now. */
  fun shouldPause(nowElapsed: Long, distanceM: Double): Boolean {
    if (distanceM - markDistance >= progressM) {
      markDistance = distanceM
      markElapsed = nowElapsed
      return false
    }
    if (nowElapsed - segmentStart < warmUpMs) return false
    if (nowElapsed - lastGoodFixElapsed > 5_000) return false
    return nowElapsed - markElapsed >= stillMs
  }

  /** Each fix while auto-paused. True means: you're moving again, resume. */
  fun shouldResume(fix: Fix): Boolean {
    val accuracy = fix.accuracyM ?: return false
    if (accuracy > goodAccuracyM) return false
    val from = anchor ?: run {
      anchor = fix
      return false
    }
    val moved = haversineM(from.lat, from.lng, fix.lat, fix.lng)
    val speed = fix.speedMps ?: 0.0
    return moved >= resumeDistanceM || (speed >= movingSpeedMps * 1.5 && moved >= resumeDistanceM / 2)
  }

  fun pausedAnchor(): Fix? = anchor
}

/** Speaks and vibrates. Lives in the engine process so it works with the screen locked. */
class CoachVoice(private val app: Context) {
  private var tts: TextToSpeech? = null
  private var ready = false

  fun prepare() {
    if (tts != null) return
    tts = TextToSpeech(app) { status ->
      ready = status == TextToSpeech.SUCCESS
      if (ready) {
        tts?.language = Locale.getDefault()
        tts?.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
      }
    }
  }

  fun speak(text: String) {
    prepare()
    if (ready) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "cardigo-${System.nanoTime()}")
  }

  fun vibrate(pattern: LongArray = longArrayOf(0, 120, 90, 120)) {
    val vibrator = if (Build.VERSION.SDK_INT >= 31) {
      app.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      app.getSystemService(Vibrator::class.java)
    } ?: return
    if (!vibrator.hasVibrator()) return
    vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
  }

  fun shutdown() {
    tts?.shutdown()
    tts = null
    ready = false
  }

  companion object {
    /** "2 kilometres completed. Average pace 8 minutes 30 seconds per kilometre." */
    fun milestoneText(milestone: Long, intervalM: Double, unit: String, activeMs: Long, distanceM: Double): String {
      val unitM = if (unit == "mi") 1609.344 else 1000.0
      val unitName = if (unit == "mi") "mile" else "kilometre"
      val covered = milestone * intervalM / unitM
      val amount = if (covered == floor(covered)) covered.toLong().toString() else String.format(Locale.US, "%.1f", covered)
      val plural = if (covered == 1.0) unitName else "${unitName}s"
      val sb = StringBuilder("$amount $plural completed.")
      if (distanceM > 50 && activeMs > 0) {
        val secPerUnit = (activeMs / 1000.0) / (distanceM / unitM)
        if (secPerUnit in 60.0..3600.0) {
          val total = secPerUnit.roundToLong()
          val min = total / 60
          val sec = total % 60
          sb.append(" Average pace $min minute${if (min == 1L) "" else "s"}")
          if (sec > 0) sb.append(" $sec second${if (sec == 1L) "" else "s"}")
          sb.append(" per $unitName.")
        }
      }
      return sb.toString()
    }
  }
}
