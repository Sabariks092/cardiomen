package com.cardiomen.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Replays known routes through the real filter with realistic GPS noise: an error that wanders
 * slowly (real GPS errors are strongly correlated over time) plus small jitter. This is a model,
 * so these numbers guard against regressions. Real accuracy still needs real walks on a phone.
 */
class AccuracyTest {
  private class Env(val sigmaM: Double, val jitterM: Double, val accuracyM: Double, val speedNoise: Double)

  private val openSky = Env(2.0, 0.3, 5.0, 0.1)
  private val city = Env(5.0, 0.8, 10.0, 0.25)
  private val poor = Env(8.0, 2.0, 18.0, 0.5)

  private fun record(speedMps: Double, env: Env, seconds: Int, seed: Long, withSpeed: Boolean = true): Pair<Double, Double> {
    val random = Random(seed)
    val filter = GpsFilter()
    var lat = 12.97
    var lng = 77.59
    var heading = 0.6
    var truth = 0.0
    var measured = 0.0
    var errorX = 0.0
    var errorY = 0.0
    val keep = 0.98
    for (t in 0 until seconds) {
      if (t % 180 == 90) heading += (Math.PI / 2) * (if (random.nextBoolean()) 1 else -1)
      heading += 0.01 * sin(t / 30.0)
      val nextLat = lat + speedMps * cos(heading) / 111_320.0
      val nextLng = lng + speedMps * sin(heading) / (111_320.0 * cos(Math.toRadians(lat)))
      truth += haversineM(lat, lng, nextLat, nextLng)
      lat = nextLat
      lng = nextLng
      val step = sqrt(1 - keep * keep) * env.sigmaM
      errorX = keep * errorX + step * random.nextGaussian()
      errorY = keep * errorY + step * random.nextGaussian()
      val x = errorX + env.jitterM * random.nextGaussian()
      val y = errorY + env.jitterM * random.nextGaussian()
      val fix = Fix(
        tMs = t * 1000L,
        lat = lat + y / 111_320.0,
        lng = lng + x / (111_320.0 * cos(Math.toRadians(lat))),
        accuracyM = env.accuracyM,
        speedMps = if (withSpeed) maxOf(0.0, speedMps + env.speedNoise * random.nextGaussian()) else null,
      )
      measured += filter.process(fix).addedMeters
    }
    return truth to measured
  }

  private fun averageErrorPercent(speedMps: Double, env: Env, withSpeed: Boolean = true): Double {
    val runs = (1L..12L).map { record(speedMps, env, 1800, it, withSpeed) }
    return runs.map { (truth, measured) -> (measured - truth) / truth * 100 }.average()
  }

  private fun check(env: Env, walk: Double, jog: Double, run: Double) {
    assertTrue("walk", abs(averageErrorPercent(1.4, env)) <= walk)
    assertTrue("jog", abs(averageErrorPercent(2.6, env)) <= jog)
    assertTrue("run", abs(averageErrorPercent(3.8, env)) <= run)
  }

  @Test fun openSkyIsWithinTwoPercent() = check(openSky, 2.0, 2.0, 2.0)

  @Test fun cityStaysClose() = check(city, 7.0, 5.0, 4.0)

  @Test fun poorSignalStaysBounded() = check(poor, 8.0, 6.0, 5.0)

  @Test fun phonesWithoutSpeedStillWork() {
    assertTrue(abs(averageErrorPercent(1.4, openSky, withSpeed = false)) <= 2.0)
    assertTrue(abs(averageErrorPercent(3.8, city, withSpeed = false)) <= 5.0)
  }

  @Test fun standingStillAddsLittle() {
    for ((env, limit) in listOf(openSky to 40.0, city to 120.0, poor to 180.0)) {
      val (_, measured) = record(0.0, env, 600, 7)
      assertTrue("phantom distance $measured m, limit $limit m", measured <= limit)
    }
  }

  @Test fun aSpeedReadingStuckAtZeroCannotEraseARun() {
    val filter = GpsFilter()
    var measured = 0.0
    val perSecond = 3.0 / 111_320.0
    for (t in 0 until 600) {
      measured += filter.process(Fix(t * 1000L, 12.97 + t * perSecond, 77.59, 5.0, speedMps = 0.0)).addedMeters
    }
    assertEquals(1800.0, measured, 120.0)
  }

  @Test fun anExactStraightRouteIsExact() {
    val filter = GpsFilter()
    var measured = 0.0
    val perSecond = 3.0 / 111_320.0
    for (t in 0 until 600) {
      measured += filter.process(Fix(t * 1000L, 12.97 + t * perSecond, 77.59, 5.0, speedMps = 3.0)).addedMeters
    }
    assertEquals(1797.0, measured, 25.0)
  }
}
