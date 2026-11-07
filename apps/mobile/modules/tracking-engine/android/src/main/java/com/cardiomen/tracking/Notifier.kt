package com.cardiomen.tracking

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.Locale

object Notifier {
  private const val CHANNEL_LIVE = "tracking_live"
  private const val CHANNEL_ALERT = "tracking_alert"
  const val ID_LIVE = 7301
  private const val ID_ALERT = 7302

  fun ensureChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_LIVE, "Live tracking", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Timer and controls while an activity is recording"
        setShowBadge(false)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ALERT, "Paused activities", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Tells you when an activity was paused by an interruption"
      },
    )
  }

  fun live(context: Context, s: Session?, activeMs: Long): Notification {
    ensureChannels(context)
    val b = NotificationCompat.Builder(context, CHANNEL_LIVE)
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_WORKOUT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openApp(context))
      .setDeleteIntent(
        PendingIntent.getBroadcast(
          context,
          3,
          Intent(context, NotificationDismissReceiver::class.java),
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
    val label = typeLabel(s?.type)
    when (s?.state) {
      SessionState.ACTIVE -> {
        b.setContentTitle("$label · ${km(s?.distanceM ?: 0.0)}")
        b.setUsesChronometer(true)
        b.setShowWhen(true)
        b.setWhen(System.currentTimeMillis() - activeMs)
        b.addAction(0, "Pause", serviceAction(context, TrackingService.ACTION_PAUSE, 1))
      }
      SessionState.PAUSED -> {
        b.setContentTitle("$label paused · ${km(s?.distanceM ?: 0.0)}")
        b.setShowWhen(false)
        b.addAction(0, "Resume", serviceAction(context, TrackingService.ACTION_RESUME, 2))
      }
      else -> {
        b.setContentTitle("$label ready")
        b.setContentText("Getting GPS position")
        b.setShowWhen(false)
      }
    }
    return b.build()
  }

  fun pausedAlert(context: Context, s: Session) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    ensureChannels(context)
    val notification = NotificationCompat.Builder(context, CHANNEL_ALERT)
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setContentTitle("Your ${typeLabel(s.type).lowercase(Locale.ROOT)} is paused")
      .setContentText("Tap to continue. Nothing was lost.")
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openApp(context))
      .build()
    context.getSystemService(NotificationManager::class.java).notify(ID_ALERT, notification)
  }

  fun cancelAlert(context: Context) {
    context.getSystemService(NotificationManager::class.java).cancel(ID_ALERT)
  }

  private fun typeLabel(type: String?) = when (type) {
    "walk" -> "Walk"
    "jog" -> "Jog"
    "run" -> "Run"
    else -> "Activity"
  }

  private fun km(meters: Double) = String.format(Locale.US, "%.2f km", meters / 1000.0)

  private fun openApp(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent()
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun serviceAction(context: Context, action: String, requestCode: Int): PendingIntent =
    PendingIntent.getForegroundService(
      context,
      requestCode,
      Intent(context, TrackingService::class.java).setAction(action),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
