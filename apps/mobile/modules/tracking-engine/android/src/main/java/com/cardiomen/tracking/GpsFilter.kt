package com.cardiomen.tracking

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
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
 */
class GpsFilter(
  private val maxAccuracyM: Double = 25.0,
  private val maxSpeedMps: Double = 12.0,
  private val minMoveM: Double = 3.0,
  private val accuracyFactor: Double = 0.5,
) {
  private var anchor: Fix? = null
  private var lastT: Long = Long.MIN_VALUE

  /** Call at every new segment. No distance is ever added across a pause or interruption. */
  fun reset() {
    anchor = null
    lastT = Long.MIN_VALUE
  }

  fun process(fix: Fix): FilterResult {
    if (fix.tMs <= lastT) return REJECTED
    lastT = fix.tMs

    val accuracy = fix.accuracyM
    if (accuracy != null && accuracy > maxAccuracyM) return REJECTED

    val from = anchor
    if (from == null) {
      anchor = fix
      return FilterResult(true, 0.0)
    }

    val meters = haversineM(from.lat, from.lng, fix.lat, fix.lng)
    val seconds = (fix.tMs - from.tMs) / 1000.0
    if (seconds <= 0.0 || meters / seconds > maxSpeedMps) return REJECTED

    // The anchor stays put until real movement, so standing-still jitter doesn't add up.
    if (meters < max(minMoveM, (accuracy ?: 0.0) * accuracyFactor)) {
      return FilterResult(false, 0.0)
    }
    anchor = fix
    return FilterResult(true, meters)
  }

  private companion object {
    val REJECTED = FilterResult(false, 0.0)
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
