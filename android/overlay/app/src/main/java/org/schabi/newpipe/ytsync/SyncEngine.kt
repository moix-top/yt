// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sincronización con yt.moix.top (POST /api/sync, contrato en web/lib/types.ts).
//
// Por qué SQL directo y no los DAO de NewPipe: este fichero vive fuera del árbol
// original y se copia encima en cada build. Los DAO cambian de firma a menudo;
// las tablas solo cambian con una migración de Room, que es rara y se ve venir
// (el workflow de upstream falla en los tests de abajo antes de publicar nada).
//
// Mapeo NewPipe ⇄ servidor:
//   posición  ⇄ stream_state.progress_time
//   visto     ⇄ progreso "terminado" según StreamStateEntity.isFinished
//   por ver   ⇄ estar en la lista local llamada PLAYLIST_NAME
//
// NewPipe no guarda cuándo cambió cada cosa, así que se guarda una foto de lo
// último sincronizado (SyncState) y lo que difiere de ella es un cambio local.

package org.schabi.newpipe.ytsync

import android.content.Context
import android.database.Cursor
import androidx.sqlite.db.SupportSQLiteDatabase
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.NewPipeDatabase
import java.util.concurrent.TimeUnit

const val PLAYLIST_NAME = "Por ver"
private const val YOUTUBE_SERVICE_ID = 0
private val VIDEO_ID = Regex("[?&]v=([A-Za-z0-9_-]{11})")

/** Lo que se sincroniza de un vídeo, ya traducido al modelo del servidor. */
data class Snap(val positionSec: Long, val queued: Boolean, val watched: Boolean)

private data class Local(
    val videoId: String,
    val streamUid: Long,
    val title: String,
    val channel: String,
    val durationSec: Long,
    val snap: Snap,
    val lastAccess: Long?,
)

class SyncEngine(private val context: Context) {
    private val prefs = SyncPrefs(context)
    private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()

    /** Un ciclo completo. Lanza excepción si falla; el Worker decide si reintenta. */
    fun run() {
        val server = prefs.server
        val token = prefs.token ?: return
        val room = NewPipeDatabase.getInstance(context)
        val db = room.openHelper.writableDatabase
        val firstSync = prefs.since == 0L
        val now = System.currentTimeMillis()

        // 1. Cambios locales desde la última foto.
        val local = readLocal(db)
        val snapshot = prefs.snapshot()
        val changes = JSONArray()
        for (l in local.values) {
            val before = snapshot[l.videoId]
            var s = l.snap
            // Terminar en el móvil un vídeo que estaba "por ver" lo saca de la
            // lista, igual que en la web.
            if (s.watched && before?.watched != true && s.queued) {
                room.runInTransaction { setQueued(db, l.streamUid, false) }
                s = s.copy(queued = false)
            }
            if (before == s) continue
            // La primera vez no hay foto: todo "difiere". Se manda con relojes
            // viejos para no pisar lo que ya se hubiera hecho en la web.
            val clock = if (firstSync) (l.lastAccess ?: 1L) else now
            val o = JSONObject().put("videoId", l.videoId)
            if (l.title.isNotEmpty()) o.put("title", l.title)
            if (l.channel.isNotEmpty()) o.put("channel", l.channel)
            if (l.durationSec > 0) o.put("durationSec", l.durationSec)
            if (before?.positionSec != s.positionSec) {
                o.put("positionSec", s.positionSec).put("positionAt", clock)
            }
            if (before?.queued != s.queued) o.put("queued", s.queued).put("queuedAt", clock)
            if (before?.watched != s.watched) o.put("watched", s.watched).put("watchedAt", clock)
            changes.put(o)
        }
        // Lo que estaba en la foto y ya no existe en local (historial borrado,
        // quitado de la lista) solo puede haber dejado de estar "por ver".
        for ((id, before) in snapshot) {
            if (id !in local && before.queued) {
                changes.put(JSONObject().put("videoId", id).put("queued", false).put("queuedAt", now))
            }
        }

        // 2. Ida y vuelta.
        val body = JSONObject().put("since", prefs.since).put("changes", changes)
        val request = Request.Builder()
            .url("${server.trimEnd('/')}/api/sync")
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val response = http.newCall(request).execute().use { r ->
            if (r.code == 401) throw SyncAuthException()
            if (!r.isSuccessful) throw java.io.IOException("HTTP ${r.code}")
            JSONObject(r.body.string())
        }

        // 3. Lo que devuelve el servidor ya es el resultado de la fusión: manda.
        val videos = response.getJSONArray("videos")
        room.runInTransaction {
            for (i in 0 until videos.length()) applyRemote(db, videos.getJSONObject(i))
        }

        // 4. Nueva foto = estado local tras aplicar. Así el siguiente ciclo solo
        // ve lo que el usuario haga a partir de ahora.
        prefs.saveSnapshot(readLocal(db).mapValues { it.value.snap })
        prefs.since = response.getLong("now")
        prefs.lastSyncAt = now
    }

    private fun readLocal(db: SupportSQLiteDatabase): Map<String, Local> {
        val playlist = findPlaylist(db)
        val sql = """
            SELECT * FROM (
              SELECT s.uid, s.url, s.title, s.uploader, s.duration, st.progress_time,
                (SELECT MAX(h.access_date) FROM stream_history h WHERE h.stream_id = s.uid) AS last_access,
                EXISTS(SELECT 1 FROM playlist_stream_join j
                       WHERE j.playlist_id = ? AND j.stream_id = s.uid) AS queued
              FROM streams s LEFT JOIN stream_state st ON st.stream_id = s.uid
              WHERE s.service_id = $YOUTUBE_SERVICE_ID
            ) WHERE progress_time IS NOT NULL OR last_access IS NOT NULL OR queued = 1
        """
        val out = HashMap<String, Local>()
        db.query(sql, arrayOf<Any?>(playlist ?: -1L)).use { c ->
            while (c.moveToNext()) {
                val id = VIDEO_ID.find(c.getString(1))?.groupValues?.get(1) ?: continue
                val duration = c.getLong(4)
                val progress = c.longOrNull(5) ?: 0L
                val watched = isFinished(progress, duration)
                out[id] = Local(
                    videoId = id,
                    streamUid = c.getLong(0),
                    title = c.getString(2) ?: "",
                    channel = c.getString(3) ?: "",
                    durationSec = duration,
                    // Terminado = posición 0, como en la web: la próxima vez empieza de cero.
                    snap = Snap(if (watched) 0 else progress / 1000, c.getInt(7) == 1, watched),
                    lastAccess = c.longOrNull(6),
                )
            }
        }
        return out
    }

    private fun applyRemote(db: SupportSQLiteDatabase, v: JSONObject) {
        val id = v.getString("videoId")
        val duration = v.optLong("durationSec", 0)
        val uid = ensureStream(db, id, v.optString("title"), v.optString("channel"), duration)

        val watched = v.optBoolean("watched")
        val position = v.optLong("positionSec", 0)
        when {
            // Visto se expresa en NewPipe como progreso al final. Sin duración
            // conocida no se puede: queda solo en el historial.
            watched && duration > 0 -> setProgress(db, uid, duration * 1000)
            position > 0 -> setProgress(db, uid, position * 1000)
            else -> db.delete("stream_state", "stream_id = ?", arrayOf(uid))
        }
        if (watched) {
            val seen = db.query("SELECT 1 FROM stream_history WHERE stream_id = ?", arrayOf(uid))
                .use { it.moveToFirst() }
            if (!seen) {
                db.execSQL(
                    "INSERT OR IGNORE INTO stream_history (stream_id, access_date, repeat_count) VALUES (?, ?, 1)",
                    arrayOf(uid, v.optLong("watchedAt", System.currentTimeMillis())),
                )
            }
        }
        setQueued(db, uid, v.optBoolean("queued"))
    }

    private fun ensureStream(
        db: SupportSQLiteDatabase, id: String, title: String, channel: String, duration: Long,
    ): Long {
        val url = "https://www.youtube.com/watch?v=$id"
        db.query("SELECT uid, duration FROM streams WHERE service_id = ? AND url = ?",
            arrayOf<Any?>(YOUTUBE_SERVICE_ID, url)).use { c ->
            if (c.moveToFirst()) {
                if (c.getLong(1) <= 0 && duration > 0) {
                    db.execSQL("UPDATE streams SET duration = ? WHERE uid = ?", arrayOf(duration, c.getLong(0)))
                }
                return c.getLong(0)
            }
        }
        db.execSQL(
            """INSERT INTO streams (service_id, url, title, stream_type, duration, uploader, thumbnail_url)
               VALUES (?, ?, ?, 'VIDEO_STREAM', ?, ?, ?)""",
            arrayOf<Any?>(YOUTUBE_SERVICE_ID, url, title.ifEmpty { id }, duration, channel,
                "https://i.ytimg.com/vi/$id/mqdefault.jpg"),
        )
        return db.query("SELECT last_insert_rowid()").use { it.moveToFirst(); it.getLong(0) }
    }

    private fun setProgress(db: SupportSQLiteDatabase, uid: Long, millis: Long) {
        db.execSQL(
            "INSERT OR REPLACE INTO stream_state (stream_id, progress_time) VALUES (?, ?)",
            arrayOf(uid, millis),
        )
    }

    private fun setQueued(db: SupportSQLiteDatabase, uid: Long, queued: Boolean) {
        val playlist = findPlaylist(db) ?: if (queued) createPlaylist(db) else return
        val present = db.query(
            "SELECT 1 FROM playlist_stream_join WHERE playlist_id = ? AND stream_id = ?",
            arrayOf(playlist, uid),
        ).use { it.moveToFirst() }
        if (queued && !present) {
            db.execSQL(
                """INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index)
                   VALUES (?, ?, (SELECT COALESCE(MAX(join_index), -1) + 1
                                  FROM playlist_stream_join WHERE playlist_id = ?))""",
                arrayOf(playlist, uid, playlist),
            )
        } else if (!queued && present) {
            db.delete("playlist_stream_join", "playlist_id = ? AND stream_id = ?", arrayOf(playlist, uid))
        }
    }

    private fun findPlaylist(db: SupportSQLiteDatabase): Long? =
        db.query("SELECT uid FROM playlists WHERE name = ? ORDER BY uid LIMIT 1", arrayOf(PLAYLIST_NAME))
            .use { if (it.moveToFirst()) it.getLong(0) else null }

    private fun createPlaylist(db: SupportSQLiteDatabase): Long {
        // display_index -1 = "sin orden manual", el mismo valor que usa NewPipe
        // para listas nuevas.
        db.execSQL(
            """INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index)
               VALUES (?, 0, -1, -1)""",
            arrayOf(PLAYLIST_NAME),
        )
        return db.query("SELECT last_insert_rowid()").use { it.moveToFirst(); it.getLong(0) }
    }
}

/** Misma regla que StreamStateEntity.isFinished, copiada para no depender de su firma. */
internal fun isFinished(progressMillis: Long, durationSec: Long): Boolean =
    durationSec > 0 &&
        progressMillis >= durationSec * 1000 - 60_000 &&
        progressMillis >= durationSec * 1000 * 3 / 4

private fun Cursor.longOrNull(i: Int): Long? = if (isNull(i)) null else getLong(i)

class SyncAuthException : Exception("Token no válido o revocado")
