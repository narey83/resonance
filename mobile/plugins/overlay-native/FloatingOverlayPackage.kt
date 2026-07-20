// <copyright file="FloatingOverlayPackage.kt" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>

package com.resonance.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class FloatingOverlayPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(FloatingOverlayModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
