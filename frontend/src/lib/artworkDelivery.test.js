import { artworkUrl, publicArtworkUrl } from './mixtapes';
import { getArtworkUrl } from './musicLibrary';

jest.mock('./api', () => ({ __esModule: true, default: {} }));
jest.mock('../config', () => ({ apiBaseUrl: '/api/v0' }));
jest.mock('./streamSignatures', () => ({
  seedSignatures: jest.fn(),
  signedQuery: () => '&exp=123&sig=test',
}));

describe('artwork delivery', () => {
  it('library artwork always requests bounded pixels and retains its path signature', () => {
    for (const size of [undefined, null, 0, -1, Number.NaN]) {
      const url = new URL(
        getArtworkUrl('/music/cover.flac', size),
        'https://app.test',
      );
      expect(url.searchParams.get('size')).toBe('192');
      expect(url.searchParams.get('sig')).toBe('test');
    }

    expect(getArtworkUrl('/music/cover.flac', 99_999)).toContain('size=2048');
  });

  it('private playlist artwork carries a scoped signature', () => {
    const url = new URL(artworkUrl('id'), 'https://app.test');
    expect(url.searchParams.get('sig')).toBe('test');
    expect(url.searchParams.has('access_token')).toBe(false);
  });

  it('private and public playlist images default to thumbnails and retain cache versions', () => {
    for (const build of [artworkUrl, publicArtworkUrl]) {
      const url = new URL(build('id', { version: 12 }), 'https://app.test');
      expect(url.searchParams.get('size')).toBe('192');
      expect(url.searchParams.get('v')).toBe('12');
      expect(url.searchParams.has('access_token')).toBe(false);

      expect(build('id', { size: 512 })).toContain('size=512');
    }
  });
});
