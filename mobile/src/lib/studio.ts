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
export const STUDIO_PRESETS = [
  { name: 'Clean', values: CLEAN_VALUES },
  { name: 'Warm pressing', values: [.08,.22,.08,.12,.08,.7,0,0,0,0,0] },
  { name: 'Drum focus', values: [.12,.08,.24,.25,.08,.9,0,0,0,0,0] },
  { name: 'Open room', values: [.18,.1,.05,.12,.22,.8,0,0,.12,0,0] },
  { name: 'Worn cassette', values: [.04,.25,0,.18,.04,.7,.12,.12,.05,.12,.2] },
] as const;
