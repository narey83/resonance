import * as prefs from '../prefs';

export const SUBTLE_PRESETS = ['clean', 'warm', 'bright'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const applySubtleSettings = (dsp) => {
  const eq = dsp.eq.snapshot();
  dsp.eq.setLow(clamp(eq.low, -3, 3));
  dsp.eq.setMid(clamp(eq.mid, -3, 3));
  dsp.eq.setHigh(clamp(eq.high, -3, 3));
  dsp.performance.setCompressionAmount(
    clamp(dsp.performance.snapshot().compressionAmount, 0, 0.25),
  );
  dsp.compressor.setAmount(clamp(dsp.compressor.snapshot().amount, 0, 0.25));
  dsp.compressor.setAttack(0.015);
  dsp.compressor.setRelease(0.25);
  dsp.saturation.setAmount(clamp(dsp.saturation.snapshot().amount, 0, 0.1));
  dsp.stereo.setWidth(clamp(dsp.stereo.snapshot().width, 0.9, 1.1));
  dsp.filter.setPosition(clamp(dsp.filter.snapshot().position, -0.1, 0.1));
  dsp.filter.setResonance(1);
  dsp.limiter.setCeiling(clamp(dsp.limiter.snapshot().ceiling, -3, -1));
  dsp.limiter.setRelease(0.15);
};

export const persistProcessingSettings = (dsp) => {
  for (const id of [
    'eq',
    'filter',
    'compressor',
    'saturation',
    'stereo',
    'limiter',
  ]) {
    for (const [key, value] of Object.entries(dsp[id].snapshot()))
      prefs.set(`mediaPlayer.dsp.${id}.${key}`, value);
  }

  const state = dsp.performance.snapshot();
  prefs.set('mediaPlayer.performanceMode', state.enabled);
  prefs.set('mediaPlayer.performanceCompression', state.compressionAmount);
  prefs.set('mediaPlayer.performanceProtection', state.protectionEnabled);
  prefs.set('mediaPlayer.performanceNormalize', state.normalizeEnabled);
};
