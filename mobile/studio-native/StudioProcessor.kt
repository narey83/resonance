package com.doublesymmetry.trackplayer.studio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder

@androidx.annotation.Keep
object StudioNative {
    init { System.loadLibrary("resonance_studio") }
    external fun create(): Long
    external fun destroy(handle: Long)
    external fun prepare(handle: Long, rate: Int)
    external fun process(handle: Long, input: ByteBuffer, offset: Int, output: ByteBuffer, bytes: Int, channels: Int)
    external fun configure(values: FloatArray, enabled: Boolean, pushed: Boolean, bypass: Boolean, eq: FloatArray, bassControl: Float, smoothness: Float, amount: Float)
    external fun meters(): FloatArray
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class StudioProcessor : BaseAudioProcessor() {
    private var handle = StudioNative.create()
    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) throw androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        return inputAudioFormat
    }
    override fun onFlush() {
        if (handle == 0L) handle = StudioNative.create()
        if (inputAudioFormat.sampleRate > 0) StudioNative.prepare(handle, inputAudioFormat.sampleRate)
    }
    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytes = inputBuffer.remaining()
        val output = replaceOutputBuffer(bytes).order(ByteOrder.nativeOrder())
        StudioNative.process(handle, inputBuffer, inputBuffer.position(), output, bytes, inputAudioFormat.channelCount)
        inputBuffer.position(inputBuffer.limit())
        output.position(bytes)
        output.flip()
    }
    override fun onReset() { StudioNative.destroy(handle); handle = 0 }
}
