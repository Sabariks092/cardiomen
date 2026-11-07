package com.cardiomen.tracking

/**
 * Turns the since-boot hardware step counter into steps for active time only.
 * The counter resets on reboot; a lower reading re-baselines and is never negative.
 */
class StepTally(var total: Int? = null) {
  private var baseline: Long? = null
  private var lastReading: Long? = null

  fun onReading(value: Long, active: Boolean) {
    lastReading = value
    if (!active) return
    val base = baseline
    if (base == null || value < base) {
      baseline = value
      if (total == null) total = 0
      return
    }
    total = (total ?: 0) + (value - base).toInt()
    baseline = value
  }

  /** Steps taken while paused must not count, so a resume restarts from the newest reading. */
  fun onSegmentStart() {
    baseline = lastReading
    if (lastReading != null && total == null) total = 0
  }
}

/** Rolling pace over the last ~30 seconds of active time. Null until enough data exists. */
class PaceWindow(private val windowMs: Long = 30_000) {
  private val samples = ArrayDeque<Pair<Long, Double>>()

  fun reset() = samples.clear()

  fun add(elapsedMs: Long, totalDistanceM: Double) {
    samples.addLast(elapsedMs to totalDistanceM)
    while (samples.size > 2 && elapsedMs - samples[1].first >= windowMs) samples.removeFirst()
  }

  fun secPerKm(): Double? {
    if (samples.size < 2) return null
    val (t0, d0) = samples.first()
    val (t1, d1) = samples.last()
    val meters = d1 - d0
    if (t1 - t0 < windowMs || meters < 5.0) return null
    return ((t1 - t0) / 1000.0) / (meters / 1000.0)
  }
}
