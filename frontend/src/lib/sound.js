let audioContext = null;

const getAudioContext = () => {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
  }

  return audioContext;
};

const tone = (ctx, { delay, duration, frequency }) => {
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.000_1, start + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
};

export const playMessageReceived = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    tone(ctx, { delay: 0, duration: 0.12, frequency: 880 });
    tone(ctx, { delay: 0.09, duration: 0.16, frequency: 1_318.5 });
  } catch {
    /* Web Audio unsupported or blocked (e.g. no user gesture yet) */
  }
};
