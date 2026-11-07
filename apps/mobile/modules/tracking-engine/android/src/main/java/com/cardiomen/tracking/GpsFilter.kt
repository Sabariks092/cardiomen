package com.cardiomen.tracking

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class Fix(
  val tMs: Long,
  val lat: Double,
  val lng: Double,
  val accuracyM: Double?,
  val altitudeM: Double? = null,
  val speedMps: Double? = null,
)

data class FilterResult(val accepted: Boolean, val addedMeters: Double)

/**
 * Decides whether a GPS fix counts toward distance. Raw fixes are always stored by the caller;
 * this only affects the distance total, so thresholds can be retuned and recalculated later.
 *
 * GPS positions wander even when you stand still, and every wander looks like movement. The speed
 * a phone reports comes from the Doppler shift of the signal, which doesn't wander, so when it's
 * available it limits how far positions can claim you've gone.
 */
class GpsFilter(
  private val maxAccuracyM: Double = 25.0,
  private val maxSpeedMps: Double = 12.0,
  private val minMoveM: Double = 5.0,
  private val accuracyFactor: Double = 0.75,
  private val speedSlack: Double = 1.15,
  private val speedPadM: Double = 3.0,
  private val trustOverrideM: Double = 30.0,
) {
  private var anchor: Fix? = null
  private var lastT: Long = Long.MIN_VALUE
  private var previousT: Long? = null
  private var speedMeters = 0.0
  private var overrides = 0

  /** Call at every new segment. No distance is ever added across a pause or interruption. */
  fun reset() {
    anchor = null
    lastT = Long.MIN_VALUE
    previousT = null
    speedMeters = 0.0
    overrides = 0
  }

  fun process(fix: Fix): FilterResult {
    if (fix.tMs <= lastT) return REJECTED
    lastT = fix.tMs

    val seconds = previousT?.let { (fix.tMs - it) / 1000.0 } ?: 0.0
    previousT = fix.tMs
    val speed = fix.speedMps?.takeIf { overrides < MAX_OVERRIDES }
    if (speed != null) speedMeters += speed * seconds

    val accuracy = fix.accuracyM
    if (accuracy != null && accuracy > maxAccuracyM) return REJECTED

    val from = anchor
    if (from == null) {
      anchor = fix
      speedMeters = 0.0
      return FilterResult(true, 0.0)
    }

    val meters = haversineM(from.lat, from.lng, fix.lat, fix.lng)
    val sinceAnchor = (fix.tMs - from.tMs) / 1000.0
    if (sinceAnchor <= 0.0 || meters / sinceAnchor > maxSpeedMps) return REJECTED

    // The anchor stays put until real movement, so standing-still jitter doesn't add up.
    if (meters < max(minMoveM, (accuracy ?: 0.0) * accuracyFactor)) {
      return FilterResult(false, 0.0)
    }

    var added = meters
    if (speed != null) {
      val explained = speedMeters * speedSlack + speedPadM
      if (meters > explained) {
        if (meters < trustOverrideM) return FilterResult(false, 0.0) // Likely wander. Wait.
        // Far beyond what speed explains. Either a big wander, or a phone whose speed reading is
        // stuck at zero. Twice in a row means the reading can't be trusted for this segment.
        overrides += 1
        added = if (overrides >= MAX_OVERRIDES) meters else min(meters, explained)
      } else {
        overrides = 0
      }
    }
    anchor = fix
    speedMeters = 0.0
    return FilterResult(true, added)
  }

  private companion object {
    val REJECTED = FilterResult(false, 0.0)
    const val MAX_OVERRIDES = 2
  }
}

fun haversineM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
  val r = 6_371_000.0
  val dLat = Math.toRadians(lat2 - lat1)
  val dLng = Math.toRadians(lng2 - lng1)
  val a = sin(dLat / 2).pow(2) +
    cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
  return 2 * r * asin(sqrt(a))
}
