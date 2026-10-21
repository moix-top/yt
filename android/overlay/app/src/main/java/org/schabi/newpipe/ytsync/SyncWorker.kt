// SPDX-License-Identifier: GPL-3.0-or-later

package org.schabi.newpipe.ytsync

import android.content.Context
import android.util.Log
import androidx.annotation.Keep
import androidx.work.Worker
import androidx.work.WorkerParameters

@Keep
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val prefs = SyncPrefs(applicationContext)
        return try {
            SyncEngine(applicationContext).run()
            prefs.lastError = null
            Result.success()
        } catch (e: SyncAuthException) {
            // Reintentar no arregla un token revocado.
            prefs.lastError = e.message
            Result.failure()
        } catch (e: Exception) {
            Log.w("YtSync", "Fallo de sincronización", e)
            prefs.lastError = e.message ?: e.javaClass.simpleName
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
