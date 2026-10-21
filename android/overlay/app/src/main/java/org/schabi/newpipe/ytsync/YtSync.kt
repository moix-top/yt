// SPDX-License-Identifier: GPL-3.0-or-later
//
// Punto de entrada: App.onCreate llama a YtSync.init (único gancho en código de
// NewPipe, ver android/patches/). Programa la sincronización:
//
//   - periódica cada 15 min (el mínimo de WorkManager), con red;
//   - al abrir la app (primera Activity visible): trae lo añadido en la web;
//   - al cerrarla (última Activity oculta): sube la posición donde lo dejaste.
//
// Las dos últimas son las que importan en la práctica; la periódica cubre la
// reproducción en segundo plano, que sigue con la app "cerrada".

package org.schabi.newpipe.ytsync

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.core.content.edit
import androidx.preference.PreferenceManager
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.schabi.newpipe.R
import java.util.concurrent.TimeUnit

object YtSync {
    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun init(app: Application) {
        applyDistractionFreeDefaults(app)
        WorkManager.getInstance(app).enqueueUniquePeriodicWork(
            "ytsync-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(network).build(),
        )
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(a: Activity) {
                if (started++ == 0) syncNow(app)
            }
            override fun onActivityStopped(a: Activity) {
                if (--started == 0) syncNow(app)
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) = Unit
            override fun onActivityResumed(a: Activity) = Unit
            override fun onActivityPaused(a: Activity) = Unit
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) = Unit
            override fun onActivityDestroyed(a: Activity) = Unit
        })
    }

    fun syncNow(app: android.content.Context) {
        if (SyncPrefs(app).token == null) return
        WorkManager.getInstance(app).enqueueUniqueWork(
            "ytsync-now",
            // APPEND: un cierre justo después de abrir no debe cancelar la subida.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(network).build(),
        )
    }

    /**
     * Ajustes por defecto "sin distracciones", aplicados UNA vez al instalar. Se
     * hace en tiempo de ejecución y no cambiando los XML de NewPipe para no
     * tener más parches que mantener; el usuario puede volver a activarlos.
     */
    private fun applyDistractionFreeDefaults(app: Application) {
        val sync = SyncPrefs(app)
        if (sync.defaultsApplied) return
        PreferenceManager.getDefaultSharedPreferences(app).edit {
            putBoolean(app.getString(R.string.show_next_video_key), false)
            putBoolean(app.getString(R.string.show_comments_key), false)
            putBoolean(app.getString(R.string.auto_queue_key), false)
            putString(app.getString(R.string.autoplay_key), app.getString(R.string.autoplay_never_key))
        }
        sync.defaultsApplied = true
    }
}
