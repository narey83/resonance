package com.resonance.mobile

import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class AdaptiveWindowModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  companion object { const val NAME = "AdaptiveWindow" }
  private var tracker: WindowInfoTrackerCallbackAdapter? = null
  private var last: WritableMap? = null
  private val callback = Consumer<WindowLayoutInfo> { info ->
    val fold = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull { it.isSeparating || it.occlusionType == FoldingFeature.OcclusionType.FULL }
    val value = Arguments.createMap()
    if (fold != null) {
      val density = context.resources.displayMetrics.density
      value.putDouble("x", fold.bounds.left / density.toDouble())
      value.putDouble("y", fold.bounds.top / density.toDouble())
      value.putDouble("width", fold.bounds.width() / density.toDouble())
      value.putDouble("height", fold.bounds.height() / density.toDouble())
      value.putBoolean("vertical", fold.orientation == FoldingFeature.Orientation.VERTICAL)
    }
    last = value
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("resonanceWindowLayout", value.copy())
  }
  init { context.addLifecycleEventListener(this) }
  override fun getName() = NAME
  private fun start() {
    stop()
    val activity = context.currentActivity ?: return
    tracker = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity)).also {
      it.addWindowLayoutInfoListener(activity, ContextCompat.getMainExecutor(activity), callback)
    }
  }
  private fun stop() { tracker?.removeWindowLayoutInfoListener(callback); tracker = null }
  @ReactMethod fun watch(promise: Promise) { context.runOnUiQueueThread { start(); promise.resolve(last?.copy()) } }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
  override fun onHostResume() = start()
  override fun onHostPause() = stop()
  override fun onHostDestroy() = stop()
  override fun invalidate() { stop(); context.removeLifecycleEventListener(this); super.invalidate() }
}
