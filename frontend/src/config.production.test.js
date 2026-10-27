import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const production = readFileSync(
  resolve(__dirname, '../.env.production'),
  'utf8',
);

describe('production frontend endpoint defaults', () => {
  it.each(['REACT_APP_API_URL', 'REACT_APP_HUB_URL'])(
    '%s stays on the page HTTPS origin',
    (key) => {
      expect.assertions(2);
      const value = production
        .split('\n')
        .find((line) => line.startsWith(key + '='))
        ?.slice(key.length + 1)
        .trim();
      expect(value).toBeTruthy();
      const pageOrigin = 'https://resonance.example:8443';
      expect(new URL(value, pageOrigin).origin).toBe(pageOrigin);
    },
  );
});
