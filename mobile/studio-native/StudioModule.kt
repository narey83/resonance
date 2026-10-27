package com.doublesymmetry.trackplayer.studio

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = StudioModule.NAME)
class StudioModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { const val NAME = "ResonanceStudio" }
    override fun getName() = NAME
    @ReactMethod fun configure(options: ReadableMap, promise: Promise) {
        try {
            val values = options.getArray("values")!!
            require(values.size() == 11)
            StudioNative.configure(FloatArray(11) { values.getDouble(it).toFloat() }, options.getBoolean("enabled"), options.getBoolean("pushed"), options.getBoolean("bypass"))
            promise.resolve(null)
        } catch (error: Exception) { promise.reject("studio_config", error) }
    }
    @ReactMethod fun meters(promise: Promise) {
        val values = StudioNative.meters()
        promise.resolve(Arguments.createMap().apply {
            putDouble("input", values[0].toDouble()); putDouble("output", values[1].toDouble())
            putDouble("reduction", values[2].toDouble()); putDouble("correlation", values[3].toDouble())
            putDouble("buffers", values[4].toDouble())
        })
    }
}
