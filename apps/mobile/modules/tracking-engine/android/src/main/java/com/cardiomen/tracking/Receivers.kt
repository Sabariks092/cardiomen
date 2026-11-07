package com.cardiomen.tracking

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Reboot or app update. Records the state and notifies. It deliberately never starts GPS. */
class SystemEventReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val trigger = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED -> Engine.TRIGGER_BOOT
      Intent.ACTION_MY_PACKAGE_REPLACED -> Engine.TRIGGER_UPDATE
      else -> return
    }
    Engine.get(context).recover(trigger)
  }
}

/** Fires only if the service stopped renewing the alarm, meaning the process died silently. */
class DeadManReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Engine.get(context).recover(Engine.TRIGGER_DEAD_MAN)
  }
}

/** From Android 14 a foreground notification can be swiped away. Tracking continues; show it again. */
class NotificationDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val engine = Engine.get(context)
    val session = engine.currentSession() ?: return
    if (session.state == SessionState.ACTIVE || session.state == SessionState.PAUSED) {
      context.getSystemService(NotificationManager::class.java)
        .notify(Notifier.ID_LIVE, Notifier.live(context, session, engine.activeMs()))
    }
  }
}
