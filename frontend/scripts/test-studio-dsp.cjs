const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let Processor;
class AudioWorkletProcessor { constructor() { this.port = { onmessage: null }; } }
const script = fs.readFileSync(path.join(__dirname, '../public/studio-worklet.js'), 'utf8');
vm.runInNewContext(script, {
  AudioWorkletProcessor, Float32Array, Math, Number, sampleRate: 48000,
  registerProcessor: (name, type) => { assert.equal(name, 'resonance-studio'); Processor = type; },
});

const controls = (overrides = {}) => ({
  enabled: true, bypass: false, pushed: false, amount: 1,
  values: Array(11).fill(0), disabled: Array(11).fill(false),
  eq: Array(8).fill(0), bassControl: 0, smoothness: 0,
  ...overrides,
});
const render = (processor, samples, settings) => {
  processor.port.onmessage({ data: { type: 'configure', controls: settings } });
  const output = [new Float32Array(samples.length), new Float32Array(samples.length)];
  assert.equal(processor.process([[samples, samples]], [output]), true);
  return output;
};

const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * .11) * .7);
const clean = render(new Processor(), signal, controls({ amount: 0,
  values: Array(11).fill(1), eq: Array(8).fill(6), bassControl: 1, smoothness: 1 }));
assert(clean[0].every(Number.isFinite));
assert(Math.max(...clean[0].map(Math.abs)) <= .891251);

const loud = Float32Array.from({ length: 128 }, () => 2);
const guarded = render(new Processor(), loud, controls({ enabled: false, bypass: true }));
assert(guarded[0].every((value) => Math.abs(value) <= .891251));

const pushed = render(new Processor(), signal, controls({ pushed: true, values: Array(11).fill(1), eq: Array(8).fill(6), bassControl: 1, smoothness: 1 }));
assert(pushed[0].every(Number.isFinite));
assert(pushed[1].every(Number.isFinite));
assert(Math.max(...pushed[0].map(Math.abs)) <= .891251);

const processor = new Processor();
processor.port.onmessage({ data: { type: 'configure', controls: controls({ values: Array(11).fill(.2) }) } });
const input = [[signal, signal]], output = [[new Float32Array(128), new Float32Array(128)]];
const start = performance.now();
for (let i = 0; i < 375; i++) processor.process(input, output);
const elapsed = performance.now() - start;
process.stdout.write(`Studio DSP: boundary, finite-output and 48k-frame render checks passed (${elapsed.toFixed(1)} ms offline).\n`);
