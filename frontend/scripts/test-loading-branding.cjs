const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');

test('startup logos match the shared animated and reduced-motion assets', () => {
  for (const [source, target] of [
    ['resonance-mark.svg', 'mark.svg'],
    ['resonance-mark-static.svg', 'mark-static.svg'],
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(frontend, 'src/assets', source)),
      fs.readFileSync(path.join(frontend, 'public/assets/brand', target)),
    );
  }
});

for (const prefix of ['', '/resonance', '/resonance/']) {
  test(`startup logo resolves on nested routes with base ${prefix || '/'}`, () => {
    const html = fs.readFileSync(
      path.join(frontend, 'public/index.html'),
      'utf8',
    );
    const script = [...html.matchAll(/<script>(.*?)<\/script>/gs)]
      .map((match) => match[1])
      .find((source) => source.includes("getElementById('splash-mark')"));
    assert.ok(script, 'Startup logo bootstrap exists');
    const elements = { 'splash-mark': {}, 'splash-still': {} };
    vm.runInNewContext(script, {
      window: { urlBase: prefix },
      document: { getElementById: (id) => elements[id] },
    });
    const base = prefix.replace(/\/$/, '');
    assert.equal(elements['splash-mark'].src, `${base}/assets/brand/mark.svg`);
    assert.equal(
      elements['splash-still'].srcset,
      `${base}/assets/brand/mark-static.svg`,
    );
    assert.match(html, /media="\(prefers-reduced-motion: reduce\)"/);
  });
}
