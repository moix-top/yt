// SPDX-License-Identifier: GPL-3.0-or-later
//
// Ajustes → Sincronización yt.moix.top. Vista construida en código, sin layouts
// ni strings en res/: cualquier recurso nuevo sería un fichero más que puede
// chocar con upstream. Los textos van en español a pelo, es una app personal.

package org.schabi.newpipe.ytsync

import android.os.Bundle
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.Keep
import androidx.fragment.app.Fragment
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.text.DateFormat
import java.util.Date

// @Keep: se instancia por nombre desde main_settings.xml y R8 no lo ve.
@Keep
class SyncSettingsFragment : Fragment() {
    private lateinit var status: TextView

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, state: Bundle?): View {
        val ctx = requireContext()
        val prefs = SyncPrefs(ctx)
        val pad = (16 * resources.displayMetrics.density).toInt()

        val server = EditText(ctx).apply {
            hint = SyncPrefs.DEFAULT_SERVER
            setText(prefs.server)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
        }
        val token = EditText(ctx).apply {
            hint = "yt_…  (créalo en la web: Dispositivos)"
            setText(prefs.token ?: "")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        status = TextView(ctx).apply { setPadding(0, pad, 0, 0) }

        val save = Button(ctx).apply {
            text = "Guardar y sincronizar"
            setOnClickListener {
                prefs.server = server.text.toString().trim().ifEmpty { SyncPrefs.DEFAULT_SERVER }
                val t = token.text.toString().trim()
                if (t != prefs.token) prefs.token = t.ifEmpty { null }
                YtSync.syncNow(ctx)
                status.text = "Sincronizando…"
            }
        }
        val now = Button(ctx).apply {
            text = "Sincronizar ahora"
            setOnClickListener {
                YtSync.syncNow(ctx)
                status.text = "Sincronizando…"
            }
        }

        WorkManager.getInstance(ctx).getWorkInfosForUniqueWorkLiveData("ytsync-now")
            .observe(viewLifecycleOwner) { infos ->
                if (infos.none { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }) {
                    render()
                }
            }

        return LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(ctx).apply {
                text = "Sincroniza la lista \"$PLAYLIST_NAME\", el historial y la posición de " +
                    "cada vídeo con la web. Se sincroniza al abrir y al cerrar la app, y cada 15 min."
            })
            addView(label("Servidor"))
            addView(server)
            addView(label("Token"))
            addView(token)
            addView(save)
            addView(now)
            addView(status)
            render()
        }
    }

    private fun label(text: String) = TextView(requireContext()).apply {
        this.text = text
        setPadding(0, (12 * resources.displayMetrics.density).toInt(), 0, 0)
    }

    private fun render() {
        val prefs = SyncPrefs(requireContext())
        val last = prefs.lastSyncAt
        status.text = buildString {
            append(
                if (prefs.token == null) "Sin configurar."
                else if (last == 0L) "Aún no se ha sincronizado."
                else "Última sincronización: " +
                    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(last))
            )
            prefs.lastError?.let { append("\nÚltimo error: $it") }
        }
    }
}
