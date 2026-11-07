package com.cardiomen.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsFilterTest {
  private val start = Fix(1_000, 12.9716, 77.5946, 5.0)

  // ~11.1 m per 0.0001 degree of latitude
  private fun north(tMs: Long, deg: Double, accuracy: Double? = 5.0) =
    Fix(tMs, 12.9716 + deg, 77.5946, accuracy)

  @Test fun firstFixIsAnchorWithNoDistance() {
    val r = GpsFilter().process(start)
    assertTrue(r.accepted)
    assertEquals(0.0, r.addedMeters, 0.0)
  }

  @Test fun realMovementAddsDistance() {
    val f = GpsFilter()
    f.process(start)
    val r = f.process(north(11_000, 0.0001))
    assertTrue(r.accepted)
    assertEquals(11.1, r.addedMeters, 0.2)
  }

  @Test fun poorAccuracyIsRejected() {
    val f = GpsFilter()
    f.process(start)
    assertFalse(f.process(north(11_000, 0.0001, accuracy = 40.0)).accepted)
  }

  @Test fun impossibleSpeedIsRejected() {
    val f = GpsFilter()
    f.process(start)
    assertFalse(f.process(north(2_000, 0.01)).accepted)
  }

  @Test fun oldTimestampIsRejected() {
    val f = GpsFilter()
    f.process(start)
    assertFalse(f.process(north(500, 0.0001)).accepted)
  }

  @Test fun standingStillJitterDoesNotAccumulate() {
    val f = GpsFilter()
    f.process(start)
    var total = 0.0
    for (i in 1..600) {
      val wobble = if (i % 2 == 0) 0.00001 else -0.00001 // ~1 m either way
      total += f.process(north(1_000L + i * 1_000, wobble)).addedMeters
    }
    assertEquals(0.0, total, 0.0)
  }

  @Test fun resetNeverAddsDistanceAcrossASegment() {
    val f = GpsFilter()
    f.process(start)
    f.reset()
    assertEquals(0.0, f.process(north(600_000, 0.01)).addedMeters, 0.0)
  }

  @Test fun missingAccuracyStillWorks() {
    val f = GpsFilter()
    f.process(start)
    assertTrue(f.process(north(11_000, 0.0001, accuracy = null)).accepted)
  }
}

class StepTallyTest {
  @Test fun noReadingMeansNoSteps() = assertNull(StepTally().total)

  @Test fun countsDifferenceFromFirstReading() {
    val t = StepTally()
    t.onReading(1000, active = true)
    t.onReading(1050, active = true)
    assertEquals(50, t.total)
  }

  @Test fun pausedStepsAreNotCounted() {
    val t = StepTally()
    t.onReading(1000, active = true)
    t.onReading(1010, active = true)
    t.onReading(1500, active = false)
    t.onSegmentStart()
    t.onReading(1520, active = true)
    assertEquals(30, t.total)
  }

  @Test fun rebootResetIsNeverNegative() {
    val t = StepTally(total = 100)
    t.onReading(5000, active = true)
    t.onReading(3, active = true)
    t.onReading(13, active = true)
    assertEquals(110, t.total)
  }
}

class PaceWindowTest {
  @Test fun hiddenUntilEnoughData() {
    val p = PaceWindow()
    p.add(0, 0.0)
    p.add(10_000, 30.0)
    assertNull(p.secPerKm())
  }

  @Test fun computesPace() {
    val p = PaceWindow()
    for (s in 0..40) p.add(s * 1000L, s * 3.0)
    assertEquals(333.3, p.secPerKm()!!, 0.5) // 3 m/s is about 5:33 per km
  }

  @Test fun standingStillShowsNoPace() {
    val p = PaceWindow()
    for (s in 0..40) p.add(s * 1000L, 100.0)
    assertNull(p.secPerKm())
  }
}

class SessionStateTest {
  @Test fun onlyActiveOrPausedCanFinish() {
    val into = SessionState.values().filter { Transitions.can(it, SessionState.FINISHED) }
    assertEquals(setOf(SessionState.ACTIVE, SessionState.PAUSED), into.toSet())
  }

  @Test fun finishedCannotBeDiscarded() {
    assertFalse(Transitions.can(SessionState.FINISHED, SessionState.DISCARDED))
  }

  @Test fun pausedCanResume() = assertTrue(Transitions.can(SessionState.PAUSED, SessionState.ACTIVE))

  @Test fun uuidIsVersion7AndUnique() {
    val a = UuidV7.generate()
    assertEquals('7', a[14])
    assertTrue(a[19] in "89ab")
    assertNotEquals(a, UuidV7.generate())
  }

  @Test fun uuidSortsByTime() {
    assertTrue(UuidV7.generate(1_000) < UuidV7.generate(2_000_000_000_000))
  }
}
