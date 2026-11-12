package com.resonance.mobile

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.LifecycleEventListener

class BackgroundChatModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  override fun getName() = "BackgroundChat"

  init { context.addLifecycleEventListener(this) }

  override fun onHostResume() { BackgroundChatService.instance?.setAppActive(true) }
  override fun onHostPause() { BackgroundChatService.instance?.setAppActive(false) }
  override fun onHostDestroy() { BackgroundChatService.instance?.setAppActive(false) }

  @ReactMethod
  fun start(serverUrl: String, refreshToken: String, sessionId: String, privateMessages: Boolean, roomMentions: Boolean, promise: Promise) {
    try {
      if (!serverUrl.startsWith("https://", ignoreCase = true) || refreshToken.isBlank() || sessionId.isBlank()) {
        promise.reject("INVALID_CHAT_SERVICE_CONFIG", "Background chat requires an HTTPS server and an active session")
        return
      }
      val intent = Intent(context, BackgroundChatService::class.java).apply {
        putExtra("serverUrl", serverUrl.trimEnd('/'))
        putExtra("refreshToken", refreshToken)
        putExtra("sessionId", sessionId)
        putExtra("privateMessages", privateMessages)
        putExtra("roomMentions", roomMentions)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("CHAT_SERVICE_START_FAILED", error)
    }
  }

  @ReactMethod
  fun update(refreshToken: String, privateMessages: Boolean, roomMentions: Boolean) {
    BackgroundChatService.instance?.update(refreshToken, privateMessages, roomMentions)
  }

  @ReactMethod
  fun setAppActive(active: Boolean) {
    BackgroundChatService.instance?.setAppActive(active)
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(BackgroundChatService.instance?.isReady() == true)
  }

  @ReactMethod
  fun stop() {
    context.stopService(Intent(context, BackgroundChatService::class.java))
  }
}
