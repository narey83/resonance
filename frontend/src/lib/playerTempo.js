export const ORIGINAL_AUDITION_TEMPO = Object.freeze({ path: null, rate: 1 });
const valid = (value) => Number.isFinite(value) && value >= 20 && value <= 400;
export const normaliseAuditionTempo = (settings) => {
  if (!settings) return ORIGINAL_AUDITION_TEMPO;
  if (
    typeof settings.path !== 'string' ||
    !settings.path ||
    !Number.isFinite(settings.rate) ||
    settings.rate < 0.75 ||
    settings.rate > 1.25
  )
    return null;
  return { path: settings.path, rate: settings.rate };
};

// Source time never changes. Only the browser's playback speed changes, so
// saved waveform positions, cues and bars stay on their authoritative timeline.
export const applyAuditionTempo = (audio, path, settings) => {
  if (!audio) return false;
  const rate = settings?.path === path ? settings.rate : 1;
  const pitchProperty =
    'preservesPitch' in audio
      ? 'preservesPitch'
      : 'webkitPreservesPitch' in audio
        ? 'webkitPreservesPitch'
        : null;
  if (rate !== 1 && !pitchProperty) {
    audio.playbackRate = 1;
    return false;
  }

  if (pitchProperty) audio[pitchProperty] = true;
  if (rate !== 1 && audio[pitchProperty] !== true) {
    audio.playbackRate = 1;
    return false;
  }

  audio.playbackRate = rate;
  return true;
};

export const masterTempoPlan = (
  aBpm,
  bBpm,
  targetBpm = aBpm,
  extended = false,
) => {
  const limit = extended ? 25 : 8;
  const side = (bpm) => {
    const known = valid(bpm) && valid(targetBpm);
    const rate = known ? targetBpm / bpm : null;
    const adjustment = known ? (rate - 1) * 100 : null;
    return {
      known,
      rate,
      adjustment,
      allowed: known && Math.abs(adjustment) <= limit + 0.000_001,
    };
  };

  return {
    target: valid(targetBpm) ? targetBpm : null,
    a: side(aBpm),
    b: side(bBpm),
    limit,
  };
};
