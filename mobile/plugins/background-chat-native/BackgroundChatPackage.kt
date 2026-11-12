package com.resonance.mobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class BackgroundChatPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == "BackgroundChat") BackgroundChatModule(reactContext) else null

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf("BackgroundChat" to ReactModuleInfo(
      "BackgroundChat", BackgroundChatModule::class.java.name,
      false, false, false, false,
    ))
  }
}
