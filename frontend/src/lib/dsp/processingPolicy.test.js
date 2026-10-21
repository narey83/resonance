import { applySubtleSettings } from './processingPolicy';

jest.mock('../prefs', () => ({ set: jest.fn() }));
const processor = (state) => {
  const result = { snapshot: () => ({ ...state }) };
  for (const key of Object.keys(state))
    result[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      state[key] = value;
    };

  return result;
};

describe('subtle processing policy', () => {
  it('returning to subtle keeps enabled choices and limits strong stored values', () => {
    const dsp = {
      eq: processor({ enabled: true, low: 12, mid: -12, high: 1 }),
      performance: processor({ enabled: true, compressionAmount: 0.9 }),
      compressor: processor({
        enabled: true,
        amount: 0.9,
        attack: 0.001,
        release: 0.05,
      }),
      saturation: processor({ enabled: false, amount: 0.8 }),
      stereo: processor({ enabled: true, width: 2 }),
      filter: processor({ enabled: true, position: -0.8, resonance: 8 }),
      limiter: processor({ enabled: true, ceiling: -0.1, release: 0.02 }),
    };
    applySubtleSettings(dsp);
    expect(dsp.eq.snapshot()).toEqual({
      enabled: true,
      low: 3,
      mid: -3,
      high: 1,
    });
    expect(dsp.compressor.snapshot()).toMatchObject({
      enabled: true,
      amount: 0.25,
      attack: 0.015,
      release: 0.25,
    });
    expect(dsp.saturation.snapshot()).toEqual({ enabled: false, amount: 0.1 });
    expect(dsp.stereo.snapshot().width).toBe(1.1);
    expect(dsp.filter.snapshot()).toMatchObject({
      position: -0.1,
      resonance: 1,
    });
    expect(dsp.limiter.snapshot()).toMatchObject({
      ceiling: -1,
      release: 0.15,
    });
  });
});
