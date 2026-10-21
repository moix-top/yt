// SPDX-License-Identifier: GPL-3.0-or-later
//
// Estado de la sincronización, en unas SharedPreferences propias para no
// mezclarse con las de NewPipe (ni salir en su copia de seguridad).

package org.schabi.newpipe.ytsync

import android.content.Context
import androidx.core.content.edit
import org.json.JSONObject

class SyncPrefs(context: Context) {
    private val p = context.getSharedPreferences("ytsync", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: DEFAULT_SERVER
        set(v) = p.edit { putString("server", v) }

    var token: String?
        get() = p.getString("token", null)?.takeIf { it.isNotBlank() }
        set(v) = p.edit {
            putString("token", v)
            // Otro token puede ser otra cuenta: se empieza de cero.
            putLong("since", 0)
            remove("snapshot")
        }

    var since: Long
        get() = p.getLong("since", 0)
        set(v) = p.edit { putLong("since", v) }

    var lastSyncAt: Long
        get() = p.getLong("lastSyncAt", 0)
        set(v) = p.edit { putLong("lastSyncAt", v) }

    var lastError: String?
        get() = p.getString("lastError", null)
        set(v) = p.edit { putString("lastError", v) }

    /** Ya se aplicaron una vez los ajustes "sin distracciones" (ver YtSync). */
    var defaultsApplied: Boolean
        get() = p.getBoolean("defaultsApplied", false)
        set(v) = p.edit { putBoolean("defaultsApplied", v) }

    fun snapshot(): Map<String, Snap> {
        val raw = p.getString("snapshot", null) ?: return emptyMap()
        val o = JSONObject(raw)
        return o.keys().asSequence().associateWith { k ->
            val s = o.getJSONArray(k)
            Snap(s.getLong(0), s.getBoolean(1), s.getBoolean(2))
        }
    }

    fun saveSnapshot(map: Map<String, Snap>) {
        val o = JSONObject()
        for ((k, s) in map) {
            o.put(k, org.json.JSONArray().put(s.positionSec).put(s.queued).put(s.watched))
        }
        p.edit { putString("snapshot", o.toString()) }
    }

    companion object {
        const val DEFAULT_SERVER = "https://yt.moix.top"
    }
}
