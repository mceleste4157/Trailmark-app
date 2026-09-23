package com.mceleste.trailmark

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.NotificationCompat

class NavigationForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIFICATION_ID, notification("Trail navigation is active"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val instruction = intent?.getStringExtra(EXTRA_INSTRUCTION) ?: "Trail navigation is active"
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID,
            notification(instruction)
        )
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Trailmark navigation",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps Trailmark trail navigation active."
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(instruction: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val carExtender = CarAppExtender.Builder()
            .setContentTitle("Trailmark navigation")
            .setContentText(instruction)
            .setSmallIcon(R.drawable.ic_trailmark)
            .setContentIntent(contentIntent)
            .setChannelId(CHANNEL_ID)
            .build()

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_trailmark)
            .setContentTitle("Trailmark navigation")
            .setContentText(instruction)
            .setContentIntent(contentIntent)
            .setCategory("navigation")
            .setOngoing(true)
            .extend(carExtender)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "trailmark_navigation"
        private const val NOTIFICATION_ID = 1001
        const val EXTRA_INSTRUCTION = "trailmark.navigation.INSTRUCTION"
    }
}
