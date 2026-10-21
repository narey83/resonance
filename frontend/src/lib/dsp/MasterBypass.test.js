import { CompressorProcessor } from './CompressorProcessor';
import { MasterBypass } from './MasterBypass';
import { PerformanceProcessor } from './PerformanceProcessor';
import { ProcessorChain } from './ProcessorChain';

const param = () => ({ value: 0, setTargetAtTime: jest.fn() });
const node = () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  gain: param(),
});
const context = () => ({
  currentTime: 4,
  createGain: node,
  createDynamicsCompressor: () => ({
    ...node(),
    attack: param(),
    release: param(),
    ratio: param(),
    knee: param(),
    threshold: param(),
  }),
});

describe('master audio bypass', () => {
  it('bypasses before loudness gain and keeps the configured rack available to resume', () => {
    const ctx = context();
    const source = node();
    const destination = node();
    const trim = node();
    const master = new MasterBypass(ctx, source, destination);
    const compressor = new CompressorProcessor(ctx);
    const chain = new ProcessorChain(ctx, trim, master.wet);
    chain.register('compressor', compressor);
    compressor.setEnabled(true);
    compressor.setAmount(0.8);
    // The raw source reaches the dry output, without going through trim or DSP.
    expect(source.connect).toHaveBeenCalledWith(master.dry);
    expect(master.dry.connect).toHaveBeenCalledWith(destination);
    expect(master.dry.gain.value).toBe(1);
    expect(master.wet.gain.value).toBe(0);
    expect(compressor.getOutputNode().connect).toHaveBeenLastCalledWith(
      master.wet,
    );
    master.setBypassed(false);
    expect(master.wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      1,
      4,
      0.015,
    );
    master.setBypassed(true);
    expect(master.wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      4,
      0.015,
    );
    expect(master.dry.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      1,
      4,
      0.015,
    );
    expect(compressor.snapshot()).toMatchObject({ enabled: true, amount: 0.8 });
  });

  it('subtle normalisation never boosts and attenuates by at most 3 dB', () => {
    const ctx = context();
    const outputGain = node();
    const unit = { setEnabled: jest.fn(), setAmount: jest.fn() };
    const performance = new PerformanceProcessor({
      compressor: unit,
      limiter: unit,
      outputGain,
      context: ctx,
    });
    performance.setEnabled(true);
    performance.setLoudnessNormalize(true, -20);
    expect(outputGain.gain.setTargetAtTime.mock.calls.at(-1)[0]).toBe(1);
    performance.setLoudnessNormalize(true, -3);
    expect(outputGain.gain.setTargetAtTime.mock.calls.at(-1)[0]).toBeCloseTo(
      10 ** (-3 / 20),
    );
    performance.setAdvanced(true);
    performance.setLoudnessNormalize(true, -20);
    expect(outputGain.gain.setTargetAtTime.mock.calls.at(-1)[0]).toBeCloseTo(
      10 ** (6 / 20),
    );
    performance.setAdvanced(false);
    expect(outputGain.gain.setTargetAtTime.mock.calls.at(-1)[0]).toBe(1);
  });

  it('zero compression has unity ratio and no automatic gain boost', () => {
    const compressor = new CompressorProcessor(context());
    compressor.setAmount(0);
    expect(
      compressor.compressor.ratio.setTargetAtTime.mock.calls.at(-1)[0],
    ).toBe(1);
    expect(compressor.makeup.gain.setTargetAtTime.mock.calls.at(-1)[0]).toBe(1);
  });
});
