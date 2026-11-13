import { resolveCastStreamOrigin } from './cast';

describe('Cast stream origin', () => {
  it('uses the public player origin even when a proxy advertises an unusable address', () => {
    expect(
      resolveCastStreamOrigin(
        'https://music.example:8443',
        'http://music.example:8443:55450',
      ),
    ).toBe('https://music.example:8443');
  });

  it('accepts a LAN origin for a localhost development page', () => {
    expect(
      resolveCastStreamOrigin(
        'http://localhost:3000',
        'http://192.168.0.80:55450',
      ),
    ).toBe('http://192.168.0.80:55450');
  });

  it('rejects malformed or credential-bearing advertised origins', () => {
    expect(
      resolveCastStreamOrigin(
        'http://localhost:3000',
        'http://host:8443:55450',
      ),
    ).toBe('http://localhost:3000');
    expect(
      resolveCastStreamOrigin(
        'http://localhost:3000',
        'http://user:pass@host:55450',
      ),
    ).toBe('http://localhost:3000');
  });
});
