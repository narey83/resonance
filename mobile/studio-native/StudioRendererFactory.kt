package com.doublesymmetry.trackplayer.studio

import android.content.Context
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class StudioRendererFactory(context: Context) : DefaultRenderersFactory(context) {
    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink {
        return DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(false)
            .setAudioProcessors(arrayOf(StudioProcessor()))
            .build()
    }
}
