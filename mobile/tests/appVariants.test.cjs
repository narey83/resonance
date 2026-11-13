const assert = require('node:assert/strict');
const test = require('node:test');

const { expo: production } = require('../app.json');
const configure = require('../app.config.js');

test('default mobile configuration retains the production identity', () => {
  const previous = process.env.APP_VARIANT;
  delete process.env.APP_VARIANT;
  try {
    const config = configure({ config: production });
    assert.equal(config.name, 'Resonance');
    assert.equal(config.android.package, 'com.resonance.mobile');
    assert.equal(config.ios.bundleIdentifier, 'com.resonance.mobile');
    assert.equal(config.scheme, 'resonance');
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
});

test('development client has an independent app and link identity', () => {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = 'development';
  try {
    const config = configure({ config: production });
    assert.equal(config.name, 'Resonance Dev');
    assert.equal(config.android.package, 'com.resonance.mobile.dev');
    assert.equal(config.ios.bundleIdentifier, 'com.resonance.mobile.dev');
    assert.equal(config.scheme, 'resonance-dev');
    assert.notEqual(config.slug, production.slug);
    assert.deepEqual(config.plugins, production.plugins);
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
});
