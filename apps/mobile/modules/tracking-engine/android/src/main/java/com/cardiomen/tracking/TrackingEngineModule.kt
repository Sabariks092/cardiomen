package com.cardiomen.tracking

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TrackingEngineModule : Module(), Engine.Listener {
  private val context get() = requireNotNull(appContext.reactContext) { "No context" }
  private val engine get() = Engine.get(context)

  override fun definition() = ModuleDefinition {
    Name("TrackingEngine")
    Events("onState", "onTick", "onPoint")

    OnCreate {
      engine.addListener(this@TrackingEngineModule)
      engine.recover(Engine.TRIGGER_LAUNCH)
    }
    OnDestroy { engine.removeListener(this@TrackingEngineModule) }

    AsyncFunction("getSnapshot") { engine.snapshot() }

    AsyncFunction("arm") { type: String, ownerId: String ->
      val id = engine.arm(type, ownerId)
      try {
        TrackingService.ensureRunning(context)
      } catch (e: Exception) {
        engine.cancelArm()
        throw e
      }
      id
    }
    AsyncFunction("cancelArm") { engine.cancelArm() }
    AsyncFunction("begin") { engine.begin() }
    AsyncFunction("pause") { engine.pause() }
    AsyncFunction("resume") {
      // The service is released during long pauses. The app is visible here, so Android allows it.
      TrackingService.ensureRunning(context)
      engine.resume()
    }
    AsyncFunction("stop") { engine.stop() }
    AsyncFunction("discard") { engine.discard() }

    AsyncFunction("getTrackPoints") { id: String, afterSeq: Double, limit: Int ->
      engine.points(id, afterSeq.toLong(), limit)
    }
    AsyncFunction("listFinished") { engine.listFinished() }
    AsyncFunction("ackImported") { id: String -> engine.ackImported(id) }
    AsyncFunction("getEvents") { limit: Int -> engine.events(limit) }

    AsyncFunction("requestIgnoreBatteryOptimizations") { requestBatteryExemption() }
    AsyncFunction("openAppSettings") {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }

  @SuppressLint("BatteryLife")
  private fun requestBatteryExemption() {
    if (engine.isIgnoringBatteryOptimizations()) return
    context.startActivity(
      Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  override fun onState(snapshot: Map<String, Any?>) = sendEvent("onState", snapshot)
  override fun onTick(snapshot: Map<String, Any?>) = sendEvent("onTick", snapshot)
  override fun onPoint(point: Map<String, Any?>) = sendEvent("onPoint", point)
}
