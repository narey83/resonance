const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('native Studio DSP preserves the peak ceiling and finite output across sample rates', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'resonance-studio-test-'));
  try {
    const binary = path.join(temporary, 'studio-dsp');
    const compile = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', path.join(__dirname, 'studio-dsp.cpp'), '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
