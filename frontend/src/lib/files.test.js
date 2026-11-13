import { getLocalStreamUrl } from './files';

jest.mock('./api', () => ({}));
jest.mock('./streamSignatures', () => ({
  signedQuery: () => '&exp=123&sig=signed',
}));
jest.mock('./token', () => ({
  getToken: () => 'token',
  isPassthroughEnabled: () => false,
}));

describe('local stream URLs', () => {
  it('requests the indexed container only for opted-in library MP3 playback', () => {
    const path = '/music/Ritual.mp3';
    const original = getLocalStreamUrl(path);
    expect(original).toContain('exp=123&sig=signed');
    expect(original).not.toContain('container=mp4');
    expect(getLocalStreamUrl(path, true)).toBe(`${original}&container=mp4`);
    expect(getLocalStreamUrl('/music/Ritual.flac', true)).not.toContain(
      'container=mp4',
    );
    expect(getLocalStreamUrl('downloads/Ritual.mp3', true)).not.toContain(
      'container=mp4',
    );
  });
});
