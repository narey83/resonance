import { mixCompatibility } from './mixCompatibility';
import {
  applyAuditionTempo,
  masterTempoPlan,
  normaliseAuditionTempo,
} from './playerTempo';

const track = (path) => ({
  track: { path, bpm: 120, key: 'Am', genre: 'House', duration: 240 },
  enhanced: {
    available: true,
    downbeats: Array.from({ length: 121 }, (_, i) => i * 2),
    singing: [],
    processedVoice: [],
    djPhrases: [],
  },
});

describe('temporary master tempo audition', () => {
  it('uses A as master by default and calculates both adjustments for a custom master', () => {
    const first = masterTempoPlan(128, 130);
    expect(first.target).toBe(128);
    expect(first.a.rate).toBe(1);
    expect(first.b.adjustment).toBeCloseTo(-1.538_46, 4);
    const custom = masterTempoPlan(128, 130, 129);
    expect(custom.a.rate).toBeCloseTo(129 / 128);
    expect(custom.b.rate).toBeCloseTo(129 / 130);
    expect(custom.a.allowed).toBe(true);
    expect(custom.b.allowed).toBe(true);
  });
  it('keeps large changes and half-time interpretations out of the subtle default range', () => {
    expect(masterTempoPlan(70, 140).b.allowed).toBe(false);
    expect(masterTempoPlan(128, 145).b.allowed).toBe(false);
    expect(masterTempoPlan(128, 145, 128, true).b.allowed).toBe(true);
    expect(masterTempoPlan(70, 140, 70, true).b.allowed).toBe(false);
    expect(normaliseAuditionTempo({ path: '/a', rate: 2 })).toBeNull();
    expect(normaliseAuditionTempo({ path: '/a', rate: Number.NaN })).toBeNull();
  });
  it('applies pitch-preserving speed only to the selected source and restores normal speed', () => {
    const audio = {
      playbackRate: 1,
      preservesPitch: false,
      currentTime: 32.25,
    };
    const settings = normaliseAuditionTempo({ path: '/b', rate: 128 / 130 });
    expect(applyAuditionTempo(audio, '/a', settings)).toBe(true);
    expect(audio.playbackRate).toBe(1);
    expect(applyAuditionTempo(audio, '/b', settings)).toBe(true);
    expect(audio.playbackRate).toBeCloseTo(128 / 130);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.currentTime).toBe(32.25);
    expect(applyAuditionTempo(audio, '/b', normaliseAuditionTempo(null))).toBe(
      true,
    );
    expect(audio.playbackRate).toBe(1);
    expect(audio.currentTime).toBe(32.25);
  });
  it('refuses adjusted audition when pitch preservation is unavailable', () => {
    const audio = { playbackRate: 1 };
    expect(applyAuditionTempo(audio, '/a', { path: '/a', rate: 1.1 })).toBe(
      false,
    );
    expect(audio.playbackRate).toBe(1);
  });
  it('refuses adjustment when the output does not accept pitch preservation', () => {
    const audio = {
      playbackRate: 1,
      get preservesPitch() {
        return false;
      },
      set preservesPitch(_value) {},
    };
    expect(applyAuditionTempo(audio, '/a', { path: '/a', rate: 1.1 })).toBe(
      false,
    );
    expect(audio.playbackRate).toBe(1);
  });
  it('changes predicted overlap elapsed time without moving source-time bar boundaries', () => {
    const normal = mixCompatibility(track('/a'), track('/b'), 16);
    const adjusted = mixCompatibility(track('/a'), track('/b'), 16, 128);
    expect(adjusted.plan.exit).toEqual(normal.plan.exit);
    expect(adjusted.plan.entry).toEqual(normal.plan.entry);
    expect(adjusted.plan.duration).toBeCloseTo(
      normal.plan.duration / (128 / 120),
    );
  });
});
