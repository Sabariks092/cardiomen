package com.cardiomen.tracking

import java.security.SecureRandom

enum class SessionState { ARMED, ACTIVE, PAUSED, FINISHED, IMPORTED, DISCARDED }

object PauseReason {
  const val USER = "user"
  const val DEVICE_SHUTDOWN = "device_shutdown"
  const val PROCESS_KILLED = "process_killed"
  const val APP_UPDATED = "app_updated"
  const val PERMISSION_REVOKED = "permission_revoked"
  const val UNKNOWN = "unknown"
}

/** Only the user can end an activity: the only ways into FINISHED are the Engine.stop() command. */
object Transitions {
  private val allowed = mapOf(
    SessionState.ARMED to setOf(SessionState.ACTIVE, SessionState.DISCARDED),
    SessionState.ACTIVE to setOf(SessionState.PAUSED, SessionState.FINISHED),
    SessionState.PAUSED to setOf(SessionState.ACTIVE, SessionState.FINISHED, SessionState.DISCARDED),
    SessionState.FINISHED to setOf(SessionState.IMPORTED),
  )

  fun can(from: SessionState, to: SessionState) = allowed[from]?.contains(to) == true
}

object UuidV7 {
  private val random = SecureRandom()

  fun generate(nowMs: Long = System.currentTimeMillis()): String {
    val b = ByteArray(16)
    random.nextBytes(b)
    for (i in 0..5) b[i] = (nowMs shr (40 - i * 8)).toByte()
    b[6] = ((b[6].toInt() and 0x0F) or 0x70).toByte()
    b[8] = ((b[8].toInt() and 0x3F) or 0x80).toByte()
    val hex = b.joinToString("") { "%02x".format(it) }
    return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-" +
      "${hex.substring(16, 20)}-${hex.substring(20)}"
  }
}
