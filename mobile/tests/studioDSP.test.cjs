const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

function verifyNative(source) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'resonance-studio-test-'));
  try {
    const binary = path.join(temporary, 'studio-dsp');
    const compile = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', path.join(__dirname, source), '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
test('native Studio DSP verifies A/B, the peak ceiling and finite output across sample rates', () => verifyNative('studio-dsp.cpp'));
test('native tone DSP shapes EQ, controls bass and treble, preserves A/B and handles rapid edits', () => verifyNative('studio-tone.cpp'));
