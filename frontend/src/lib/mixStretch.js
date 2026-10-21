import { Stretch } from '@soundtouchjs/core';

// Render bar by bar in a worker. Every boundary has an absolute output sample
// index; rounding or WSOLA sequence lengths cannot accumulate across the mix.
// Small context handles and crossfades keep joins continuous. This is key lock,
// not resampling: the source's pitch stays unchanged.
export const stretchBars = ({
  channels,
  sampleRate,
  knots,
  bpm,
  clipStart,
  outputBarOffset = 0,
}) => {
  const barFrames = (240 * sampleRate) / bpm;
  const origin = Math.round(outputBarOffset * barFrames);
  const length =
    Math.round((outputBarOffset + knots.length - 1) * barFrames) - origin;
  const output = [new Float32Array(length), new Float32Array(length)];
  const handle = Math.round(sampleRate * 0.006);
  for (let bar = 0; bar < knots.length - 1; bar++) {
    const lo = Math.round((outputBarOffset + bar) * barFrames) - origin;
    const hi = Math.round((outputBarOffset + bar + 1) * barFrames) - origin;
    const rate = ((knots[bar + 1] - knots[bar]) * sampleRate) / (hi - lo);
    if (!Number.isFinite(rate) || rate < 0.749_99 || rate > 1.250_01)
      throw new Error('Bar timing exceeds the supported stretch range.');
    const prefix = Math.round(sampleRate * 0.12);
    const inputStart =
      Math.round((knots[bar] - clipStart) * sampleRate) - prefix;
    // Stretch bootstraps its overlap history by consuming that many input
    // samples. Compensate before cropping away the source context handle.
    let crop = Math.round((prefix - Math.round(sampleRate * 0.008)) / rate);
    const frames = Math.ceil(
      (hi - lo + handle * 2 + crop) * rate + sampleRate * 0.2,
    );
    const input = new Float32Array(frames * 2);
    const left = channels[0];
    const right = channels[1] || left;
    for (let i = 0; i < frames; i++) {
      input[i * 2] = left[inputStart + i] || 0;
      input[i * 2 + 1] = right[inputStart + i] || 0;
    }

    let processed;
    if (Math.abs(rate - 1) < 1e-7) {
      processed = input;
      crop = prefix;
    } else {
      const stretch = new Stretch({ createBuffers: true, sampleRate });
      stretch.setStretchParameters({
        sequenceMs: 40,
        seekWindowMs: 8,
        overlapMs: 8,
        quickSeek: true,
      });
      stretch.tempo = rate;
      stretch.inputBuffer.putSamples(input);
      stretch.process();
      processed = new Float32Array(stretch.outputBuffer.frameCount * 2);
      stretch.outputBuffer.extract(
        processed,
        0,
        stretch.outputBuffer.frameCount,
      );
      stretch.clear();
    }

    const from = Math.max(0, lo - handle);
    const to = Math.min(length, hi + handle);
    if (crop + to - lo >= processed.length / 2)
      throw new Error('Time stretch did not produce a complete bar.');
    for (let frame = from; frame < to; frame++) {
      const relative = frame - lo;
      let weight = 1;
      if (bar > 0 && frame < lo + handle)
        weight = (frame - (lo - handle)) / (2 * handle);
      if (bar < knots.length - 2 && frame >= hi - handle)
        weight = Math.min(weight, (hi + handle - frame) / (2 * handle));
      const index = (crop + relative) * 2;
      output[0][frame] += (processed[index] || 0) * weight;
      output[1][frame] += (processed[index + 1] || 0) * weight;
    }
  }

  const edge = Math.round(sampleRate * 0.002);
  for (let i = 0; i < edge; i++) {
    for (const channel of output) {
      channel[i] *= i / edge;
      channel[length - 1 - i] *= i / edge;
    }
  }

  return output;
};
