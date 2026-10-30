export const STUDIO_MODULES = [
  { id: 'exciter', title: 'Harmonic exciter', detail: 'High-frequency harmonics for air and bite', safe: .35, group: 'mastering' },
  { id: 'warmth', title: 'Tape warmth', detail: 'Soft saturation for density and colour', safe: .35, group: 'mastering' },
  { id: 'punch', title: 'Transient shaper', detail: 'Bring drum attacks forward', safe: .3, group: 'mastering' },
  { id: 'glue', title: 'Glue compressor', detail: 'Linked stereo compression, without makeup gain', safe: .4, group: 'mastering' },
  { id: 'width', title: 'Stereo width', detail: 'Open the sides; use subtle amounts to preserve mono detail', safe: .3, group: 'mastering' },
  { id: 'monoBass', title: 'Mono bass', detail: 'Centre the low frequencies below 140 Hz', safe: 1, group: 'mastering' },
  { id: 'flutter', title: 'Tape flutter', detail: 'Slow pitch movement and worn-tape character', safe: .15, group: 'creative' },
  { id: 'echo', title: 'Tape echo', detail: '280 ms echo with restrained feedback', safe: .25, group: 'creative' },
  { id: 'room', title: 'Short room', detail: 'Early reflections for a little space', safe: .25, group: 'creative' },
  { id: 'crush', title: 'Bit texture', detail: 'Reduce resolution for grain and grit', safe: .15, group: 'creative' },
  { id: 'filter', title: 'Tone filter', detail: 'Roll off the top for a darker texture', safe: .3, group: 'creative' },
] as const;
export type StudioValues = number[];
export const CLEAN_VALUES = STUDIO_MODULES.map(() => 0);
export function clampStudio(values: unknown, pushed = false): StudioValues {
  return STUDIO_MODULES.map((module, index) => {
    const value = Array.isArray(values) ? values[index] : 0;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(pushed ? 1 : module.safe, value)) : 0;
  });
}
export const STUDIO_PRESETS: readonly StudioPreset[] = [
  { name: 'Clean', values: CLEAN_VALUES },
  { name: 'Warm pressing', values: [.08,.22,.08,.12,.08,.7,0,0,0,0,0] },
  { name: 'Drum focus', values: [.12,.08,.24,.25,.08,.9,0,0,0,0,0] },
  { name: 'Open room', values: [.18,.1,.05,.12,.22,.8,0,0,.12,0,0] },
  { name: 'Worn cassette', values: [.04,.25,0,.18,.04,.7,.12,.12,.05,.12,.2] },
  { name: 'Resonance Enhance', values: [.02,.06,.04,.04,0,0,0,0,0,0,0], tones: {
    headphones: { eq: [2.2,.7,-.7,-.4,0,.5,-.4,.7], bassControl: .35, smoothness: .25, amount: .65 },
    speakers: { eq: [.6,.3,-.8,-.3,0,.3,-.3,.3], bassControl: .4, smoothness: .2, amount: .65 },
  } },
  { name: 'Deep & Clean', values: [0,.04,.05,.03,0,0,0,0,0,0,0], tones: {
    headphones: { eq: [3,1,-1,-.5,0,0,-.2,.2], bassControl: .6, smoothness: .1, amount: .65 },
    speakers: { eq: [1,.5,-1,-.4,0,.1,-.1,0], bassControl: .65, smoothness: .1, amount: .65 },
  } },
  { name: 'Smooth Detail', values: [0,.04,0,.02,0,0,0,0,0,0,0], tones: {
    headphones: { eq: [.6,0,-.4,0,0,-.5,-1.5,.5], bassControl: .15, smoothness: .65, amount: .65 },
    speakers: { eq: [0,0,-.3,0,0,-.3,-1,.2], bassControl: .25, smoothness: .6, amount: .65 },
  } },
];

export type StudioOutputProfile = 'headphones' | 'speakers';
export const STUDIO_EQ_BANDS = [
  { hz: 60, label: '60 Hz', detail: 'Sub bass' },
  { hz: 120, label: '120 Hz', detail: 'Bass' },
  { hz: 250, label: '250 Hz', detail: 'Body' },
  { hz: 500, label: '500 Hz', detail: 'Lower mids' },
  { hz: 1000, label: '1 kHz', detail: 'Mids' },
  { hz: 2500, label: '2.5 kHz', detail: 'Presence' },
  { hz: 6000, label: '6 kHz', detail: 'Detail' },
  { hz: 12000, label: '12 kHz', detail: 'Air' },
] as const;
export interface StudioToneSettings { eq: number[]; bassControl: number; smoothness: number; amount: number }
export interface StudioPreset {
  name: string;
  values: readonly number[];
  tone?: StudioToneSettings;
  tones?: Record<StudioOutputProfile, StudioToneSettings>;
}
export function studioNumber(value: unknown, min: number, max: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
export function clampTone(value?: unknown): StudioToneSettings {
  const data = value && typeof value === 'object' ? value as Partial<StudioToneSettings> : {};
  return {
    eq: STUDIO_EQ_BANDS.map((_, i) => studioNumber(Array.isArray(data.eq) ? data.eq[i] : 0, -6, 6)),
    bassControl: studioNumber(data.bassControl, 0, 1),
    smoothness: studioNumber(data.smoothness, 0, 1),
    amount: studioNumber(data.amount, 0, 1, 1),
  };
}
export function presetTone(preset: StudioPreset, output: StudioOutputProfile): StudioToneSettings {
  return clampTone(preset.tones?.[output] ?? preset.tone);
}
export function needsStudioTone(preset: StudioPreset, output: StudioOutputProfile): boolean {
  const tone = presetTone(preset, output);
  return tone.eq.some(value => value !== 0) || tone.bassControl > 0 || tone.smoothness > 0 || tone.amount !== 1;
}
