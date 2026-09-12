// <copyright file="FloatingOverlayPackage.kt" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>

package com.resonance.mobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

// BaseReactPackage rather than ReactPackage: under the new architecture ReactPackage's
// createNativeModules is deprecated in favour of getModule, and BaseReactPackage is what
// supplies the lazy module lookup the TurboModule registry expects.
class FloatingOverlayPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == FloatingOverlayModule.NAME) FloatingOverlayModule(reactContext) else null

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()

  // FloatingOverlayModule is a plain ReactContextBaseJavaModule, so it is neither a C++ nor a
  // TurboModule, and it has nothing to do before JS asks for it.
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      FloatingOverlayModule.NAME to
        ReactModuleInfo(
          FloatingOverlayModule.NAME,
          FloatingOverlayModule::class.java.name,
          /* canOverrideExistingModule = */ false,
          /* needsEagerInit = */ false,
          /* isCxxModule = */ false,
          /* isTurboModule = */ false,
        )
    )
  }
}
