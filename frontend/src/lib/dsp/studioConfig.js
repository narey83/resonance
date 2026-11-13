// Browser Studio settings mirror the mobile rack. Keep the two preset tables in sync.
export const MODULES = [
  [
    'exciter',
    'Harmonic exciter',
    'High-frequency harmonics for air and bite',
    0.35,
    'mastering',
  ],
  [
    'warmth',
    'Tape warmth',
    'Soft saturation for density and colour',
    0.35,
    'mastering',
  ],
  ['punch', 'Transient shaper', 'Bring drum attacks forward', 0.3, 'mastering'],
  [
    'glue',
    'Glue compressor',
    'Linked stereo compression, without makeup gain',
    0.4,
    'mastering',
  ],
  [
    'width',
    'Stereo width',
    'Open the sides; use subtle amounts to preserve mono detail',
    0.3,
    'mastering',
  ],
  [
    'monoBass',
    'Mono bass',
    'Centre the low frequencies below 140 Hz',
    1,
    'mastering',
  ],
  [
    'flutter',
    'Tape flutter',
    'Slow pitch movement and worn-tape character',
    0.15,
    'creative',
  ],
  [
    'echo',
    'Tape echo',
    '280 ms echo with restrained feedback',
    0.25,
    'creative',
  ],
  [
    'room',
    'Short room',
    'Early reflections for a little space',
    0.25,
    'creative',
  ],
  [
    'crush',
    'Bit texture',
    'Reduce resolution for grain and grit',
    0.15,
    'creative',
  ],
  [
    'filter',
    'Tone filter',
    'Roll off the top for a darker texture',
    0.3,
    'creative',
  ],
];
export const BANDS = [60, 120, 250, 500, 1_000, 2_500, 6_000, 12_000];
const clean = MODULES.map(() => 0);
export const PRESETS = [
  { name: 'Clean', values: clean },
  {
    name: 'Warm pressing',
    values: [0.08, 0.22, 0.08, 0.12, 0.08, 0.7, 0, 0, 0, 0, 0],
  },
  {
    name: 'Drum focus',
    values: [0.12, 0.08, 0.24, 0.25, 0.08, 0.9, 0, 0, 0, 0, 0],
  },
  {
    name: 'Open room',
    values: [0.18, 0.1, 0.05, 0.12, 0.22, 0.8, 0, 0, 0.12, 0, 0],
  },
  {
    name: 'Worn cassette',
    values: [0.04, 0.25, 0, 0.18, 0.04, 0.7, 0.12, 0.12, 0.05, 0.12, 0.2],
  },
  {
    name: 'Resonance Enhance',
    values: [0.02, 0.06, 0.04, 0.04, 0, 0, 0, 0, 0, 0, 0],
    tones: {
      headphones: {
        eq: [2.2, 0.7, -0.7, -0.4, 0, 0.5, -0.4, 0.7],
        bassControl: 0.35,
        smoothness: 0.25,
        amount: 0.65,
      },
      speakers: {
        eq: [0.6, 0.3, -0.8, -0.3, 0, 0.3, -0.3, 0.3],
        bassControl: 0.4,
        smoothness: 0.2,
        amount: 0.65,
      },
    },
  },
  {
    name: 'Deep & Clean',
    values: [0, 0.04, 0.05, 0.03, 0, 0, 0, 0, 0, 0, 0],
    tones: {
      headphones: {
        eq: [3, 1, -1, -0.5, 0, 0, -0.2, 0.2],
        bassControl: 0.6,
        smoothness: 0.1,
        amount: 0.65,
      },
      speakers: {
        eq: [1, 0.5, -1, -0.4, 0, 0.1, -0.1, 0],
        bassControl: 0.65,
        smoothness: 0.1,
        amount: 0.65,
      },
    },
  },
  {
    name: 'Smooth Detail',
    values: [0, 0.04, 0, 0.02, 0, 0, 0, 0, 0, 0, 0],
    tones: {
      headphones: {
        eq: [0.6, 0, -0.4, 0, 0, -0.5, -1.5, 0.5],
        bassControl: 0.15,
        smoothness: 0.65,
        amount: 0.65,
      },
      speakers: {
        eq: [0, 0, -0.3, 0, 0, -0.3, -1, 0.2],
        bassControl: 0.25,
        smoothness: 0.6,
        amount: 0.65,
      },
    },
  },
];
export const clamp = (value, min, max, fallback = min) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export const readProfile = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: value.enabled === true,
    values: MODULES.map((module, i) => clamp(value.values?.[i], 0, module[3])),
    disabled: MODULES.map((_, i) => value.disabled?.[i] === true),
    eq: BANDS.map((_, i) => clamp(value.eq?.[i], -6, 6, 0)),
    bassControl: clamp(value.bassControl, 0, 1),
    smoothness: clamp(value.smoothness, 0, 1),
    amount: clamp(value.amount, 0, 1, 1),
    selectedPreset:
      typeof value.selectedPreset === 'string' ? value.selectedPreset : null,
  };
};

export const readStudio = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    output: value.output === 'speakers' ? 'speakers' : 'headphones',
    profiles: {
      headphones: readProfile(value.profiles?.headphones),
      speakers: readProfile(value.profiles?.speakers),
    },
    presets: Array.isArray(value.presets)
      ? value.presets
          .slice(0, 12)
          .filter((preset) => typeof preset?.name === 'string')
          .map((preset) => ({
            name: preset.name.slice(0, 40),
            ...readProfile(preset),
          }))
      : [],
  };
};
