package com.cardiomen.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MilestoneTrackerTest {
  @Test fun announcesEachMilestoneOnce() {
    val m = MilestoneTracker()
    assertNull(m.check("a", 0.0, 1000.0))
    assertNull(m.check("a", 999.0, 1000.0))
    assertEquals(1L, m.check("a", 1000.5, 1000.0))
    assertNull(m.check("a", 1500.0, 1000.0))
    assertEquals(2L, m.check("a", 2001.0, 1000.0))
  }

  @Test fun restartMidSessionDoesNotRepeat() {
    val m = MilestoneTracker()
    // First sighting of a session already past 3 km: nothing is announced for the past.
    assertNull(m.check("b", 3200.0, 1000.0))
    assertNull(m.check("b", 3900.0, 1000.0))
    assertEquals(4L, m.check("b", 4000.0, 1000.0))
  }
}

class AutoPauseTest {
  private fun fix(t: Long, dLat: Double = 0.0, acc: Double? = 5.0, speed: Double? = 0.0) =
    Fix(t, 12.9716 + dLat, 77.5946, acc, null, speed)

  @Test fun pausesAfterStandingStillWithGoodGps() {
    val d = AutoPauseDetector()
    d.onSegmentStart(0, 0.0)
    for (t in 0L..40_000L step 1000) {
      d.onActiveFix(t, fix(t), 100.0)
    }
    assertTrue(d.shouldPause(40_000, 100.0))
  }

  @Test fun neverPausesDuringWarmUp() {
    val d = AutoPauseDetector()
    d.onSegmentStart(0, 0.0)
    for (t in 0L..18_000L step 1000) d.onActiveFix(t, fix(t), 0.0)
    assertFalse(d.shouldPause(18_000, 0.0))
  }

  @Test fun lostSignalDoesNotPause() {
    val d = AutoPauseDetector()
    d.onSegmentStart(0, 0.0)
    d.onActiveFix(1_000, fix(1_000), 0.0)
    // No fixes since: a tunnel. Must keep recording.
    assertFalse(d.shouldPause(60_000, 0.0))
  }

  @Test fun movingKeepsRecording() {
    val d = AutoPauseDetector()
    d.onSegmentStart(0, 0.0)
    var dist = 0.0
    for (t in 0L..60_000L step 1000) {
      dist += 2.5
      d.onActiveFix(t, fix(t, speed = 2.5), dist)
      assertFalse(d.shouldPause(t, dist))
    }
  }

  @Test fun resumesOnlyAfterClearMovement() {
    val d = AutoPauseDetector()
    d.onSegmentStart(0, 0.0)
    d.onActiveFix(1_000, fix(1_000), 0.0)
    assertFalse(d.shouldResume(fix(2_000, dLat = 0.00005))) // ~5.5 m of wander
    assertFalse(d.shouldResume(fix(3_000, dLat = 0.0003, acc = 40.0))) // poor accuracy
    assertTrue(d.shouldResume(fix(4_000, dLat = 0.0002))) // ~22 m away
  }
}

class CoachTextTest {
  @Test fun kilometreAnnouncement() {
    val text = CoachVoice.milestoneText(1, 1000.0, "km", 510_000, 1000.0)
    assertEquals("1 kilometre completed. Average pace 8 minutes 30 seconds per kilometre.", text)
  }

  @Test fun halfKilometreIntervalsAndPlural() {
    val text = CoachVoice.milestoneText(3, 500.0, "km", 600_000, 1500.0)
    assertEquals("1.5 kilometres completed. Average pace 6 minutes 40 seconds per kilometre.", text)
  }
}
