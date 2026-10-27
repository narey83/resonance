import api from './api';
import { clearSignatures, ensureSigned, signedQuery } from './streamSignatures';

jest.mock('./api', () => ({ post: jest.fn() }));
describe('stream signature batches', () => {
  it('signs a large queue in bounded batches without losing the final tracks', async () => {
    expect.hasAssertions();
    clearSignatures();
    api.post.mockImplementation(async (_, { paths }) => ({
      data: Object.fromEntries(
        paths.map((path) => [path, { sig: 'signed', exp: 9_999_999_999 }]),
      ),
    }));
    await ensureSigned(
      Array.from({ length: 2_200 }, (_, i) => `/music/${i}.mp3`),
    );
    expect(api.post.mock.calls.map((call) => call[1].paths.length)).toEqual([
      1_000, 1_000, 200,
    ]);
    expect(signedQuery('/music/2199.mp3')).toContain('sig=signed');
  });
});
