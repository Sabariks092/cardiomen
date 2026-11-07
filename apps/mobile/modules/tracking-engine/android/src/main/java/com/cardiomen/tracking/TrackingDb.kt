package com.cardiomen.tracking

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Session(
  val id: String,
  val ownerId: String,
  val type: String,
  var state: SessionState,
  var pauseReason: String? = null,
  var startedAtWall: Long? = null,
  val tzOffsetMin: Int,
  var activeMs: Long = 0,
  var segmentNo: Int = 0,
  var bootCount: Int,
  var appVersion: Long,
  var lastWallMs: Long? = null,
  var distanceM: Double = 0.0,
  var steps: Int? = null,
  var finishedAtWall: Long? = null,
  var importedAtWall: Long? = null,
  var nextPointSeq: Long = 0,
  var nextEventSeq: Long = 0,
)

data class PointRow(val seq: Long, val segmentNo: Int, val fix: Fix, val accepted: Boolean)

/** Only the engine touches this database. JS reads it through the module API. */
class TrackingDb(context: Context) :
  SQLiteOpenHelper(context, "tracking.db", null, VERSION) {

  override fun onConfigure(db: SQLiteDatabase) {
    db.enableWriteAheadLogging()
    // FULL means a committed transaction survives sudden power loss, not just a process crash.
    db.rawQuery("PRAGMA synchronous = FULL", null).use { it.moveToFirst() }
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """CREATE TABLE session (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        pause_reason TEXT,
        started_at_wall INTEGER,
        tz_offset_min INTEGER NOT NULL,
        active_ms INTEGER NOT NULL DEFAULT 0,
        segment_no INTEGER NOT NULL DEFAULT 0,
        boot_count INTEGER NOT NULL,
        app_version INTEGER NOT NULL,
        last_wall_ms INTEGER,
        distance_m REAL NOT NULL DEFAULT 0,
        steps INTEGER,
        finished_at_wall INTEGER,
        imported_at_wall INTEGER,
        next_point_seq INTEGER NOT NULL DEFAULT 0,
        next_event_seq INTEGER NOT NULL DEFAULT 0,
        engine_version INTEGER NOT NULL
      )""",
    )
    db.execSQL("CREATE INDEX session_state ON session(state)")
    db.execSQL(
      """CREATE TABLE point (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        segment_no INTEGER NOT NULL,
        t_wall INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy_m REAL,
        altitude_m REAL,
        speed_mps REAL,
        accepted INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      ) WITHOUT ROWID""",
    )
    db.execSQL(
      """CREATE TABLE event (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        t_wall INTEGER NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT,
        PRIMARY KEY (session_id, seq)
      ) WITHOUT ROWID""",
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Forward-only migrations go here. There are none yet.
  }

  fun insertSession(s: Session) {
    writableDatabase.insertOrThrow("session", null, values(s).apply { put("id", s.id) })
  }

  /** Points, event rows and the checkpoint commit together, so they can never disagree. */
  fun commit(s: Session, points: List<PointRow>, events: List<Pair<String, String?>> = emptyList()) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      for (p in points) {
        db.insertWithOnConflict(
          "point",
          null,
          ContentValues().apply {
            put("session_id", s.id)
            put("seq", p.seq)
            put("segment_no", p.segmentNo)
            put("t_wall", p.fix.tMs)
            put("lat", p.fix.lat)
            put("lng", p.fix.lng)
            put("accuracy_m", p.fix.accuracyM)
            put("altitude_m", p.fix.altitudeM)
            put("speed_mps", p.fix.speedMps)
            put("accepted", if (p.accepted) 1 else 0)
          },
          SQLiteDatabase.CONFLICT_IGNORE,
        )
      }
      for ((kind, detail) in events) {
        db.insertOrThrow(
          "event",
          null,
          ContentValues().apply {
            put("session_id", s.id)
            put("seq", s.nextEventSeq++)
            put("t_wall", System.currentTimeMillis())
            put("kind", kind)
            put("detail", detail)
          },
        )
      }
      db.update("session", values(s), "id = ?", arrayOf(s.id))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun loadOpenSession(): Session? = readableDatabase.rawQuery(
    "SELECT * FROM session WHERE state IN ('ARMED','ACTIVE','PAUSED') ORDER BY id DESC LIMIT 1",
    null,
  ).use { if (it.moveToFirst()) it.toSession() else null }

  fun loadFinished(): List<Session> = readableDatabase.rawQuery(
    "SELECT * FROM session WHERE state = 'FINISHED' ORDER BY id",
    null,
  ).use { c -> buildList { while (c.moveToNext()) add(c.toSession()) } }

  fun loadSession(id: String): Session? = readableDatabase.rawQuery(
    "SELECT * FROM session WHERE id = ?",
    arrayOf(id),
  ).use { if (it.moveToFirst()) it.toSession() else null }

  fun loadPoints(id: String, afterSeq: Long, limit: Int): List<PointRow> = readableDatabase.rawQuery(
    """SELECT seq, segment_no, t_wall, lat, lng, accuracy_m, altitude_m, speed_mps, accepted
       FROM point WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?""",
    arrayOf(id, afterSeq.toString(), limit.toString()),
  ).use { c ->
    buildList {
      while (c.moveToNext()) {
        add(
          PointRow(
            seq = c.getLong(0),
            segmentNo = c.getInt(1),
            fix = Fix(
              tMs = c.getLong(2),
              lat = c.getDouble(3),
              lng = c.getDouble(4),
              accuracyM = c.doubleOrNull(5),
              altitudeM = c.doubleOrNull(6),
              speedMps = c.doubleOrNull(7),
            ),
            accepted = c.getInt(8) == 1,
          ),
        )
      }
    }
  }

  fun loadEvents(limit: Int): List<Map<String, Any?>> = readableDatabase.rawQuery(
    "SELECT session_id, t_wall, kind, detail FROM event ORDER BY t_wall DESC, seq DESC LIMIT ?",
    arrayOf(limit.toString()),
  ).use { c ->
    buildList {
      while (c.moveToNext()) {
        add(
          mapOf(
            "sessionId" to c.getString(0),
            "tWall" to c.getLong(1).toDouble(),
            "kind" to c.getString(2),
            "detail" to if (c.isNull(3)) null else c.getString(3),
          ),
        )
      }
    }
  }

  fun deleteSessionData(id: String) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.delete("point", "session_id = ?", arrayOf(id))
      db.delete("event", "session_id = ?", arrayOf(id))
      db.delete("session", "id = ?", arrayOf(id))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** Imported recordings are kept for 30 days as a safety copy. */
  fun purgeImportedBefore(cutoffWallMs: Long) {
    val ids = readableDatabase.rawQuery(
      "SELECT id FROM session WHERE state = 'IMPORTED' AND imported_at_wall < ?",
      arrayOf(cutoffWallMs.toString()),
    ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
    ids.forEach(::deleteSessionData)
  }

  private fun values(s: Session) = ContentValues().apply {
    put("owner_id", s.ownerId)
    put("type", s.type)
    put("state", s.state.name)
    put("pause_reason", s.pauseReason)
    put("started_at_wall", s.startedAtWall)
    put("tz_offset_min", s.tzOffsetMin)
    put("active_ms", s.activeMs)
    put("segment_no", s.segmentNo)
    put("boot_count", s.bootCount)
    put("app_version", s.appVersion)
    put("last_wall_ms", s.lastWallMs)
    put("distance_m", s.distanceM)
    put("steps", s.steps)
    put("finished_at_wall", s.finishedAtWall)
    put("imported_at_wall", s.importedAtWall)
    put("next_point_seq", s.nextPointSeq)
    put("next_event_seq", s.nextEventSeq)
    put("engine_version", ENGINE_VERSION)
  }

  private fun Cursor.toSession(): Session {
    fun i(name: String) = getColumnIndexOrThrow(name)
    return Session(
      id = getString(i("id")),
      ownerId = getString(i("owner_id")),
      type = getString(i("type")),
      state = SessionState.valueOf(getString(i("state"))),
      pauseReason = stringOrNull(i("pause_reason")),
      startedAtWall = longOrNull(i("started_at_wall")),
      tzOffsetMin = getInt(i("tz_offset_min")),
      activeMs = getLong(i("active_ms")),
      segmentNo = getInt(i("segment_no")),
      bootCount = getInt(i("boot_count")),
      appVersion = getLong(i("app_version")),
      lastWallMs = longOrNull(i("last_wall_ms")),
      distanceM = getDouble(i("distance_m")),
      steps = longOrNull(i("steps"))?.toInt(),
      finishedAtWall = longOrNull(i("finished_at_wall")),
      importedAtWall = longOrNull(i("imported_at_wall")),
      nextPointSeq = getLong(i("next_point_seq")),
      nextEventSeq = getLong(i("next_event_seq")),
    )
  }

  private fun Cursor.stringOrNull(i: Int) = if (isNull(i)) null else getString(i)
  private fun Cursor.longOrNull(i: Int) = if (isNull(i)) null else getLong(i)
  private fun Cursor.doubleOrNull(i: Int) = if (isNull(i)) null else getDouble(i)

  companion object {
    const val VERSION = 1
    const val ENGINE_VERSION = 1
  }
}
