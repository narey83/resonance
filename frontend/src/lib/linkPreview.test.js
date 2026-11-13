import api from './api';
import { getPreview } from './linkPreview';

jest.mock('./api', () => ({ get: jest.fn() }));

describe('chat link previews', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    api.get.mockReset();
  });

  it('deduplicates successful requests', async () => {
    expect.assertions(3);
    const url = 'https://example.com/success';
    api.get.mockResolvedValue({ data: { title: 'Example' } });

    await expect(getPreview({ url })).resolves.toEqual({ title: 'Example' });
    await expect(getPreview({ url })).resolves.toEqual({ title: 'Example' });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('retries failed requests after the miss expires', async () => {
    expect.assertions(5);
    const url = 'https://example.com/temporary-failure';
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    api.get.mockRejectedValueOnce(new Error('offline'));
    api.get.mockResolvedValueOnce({ data: { title: 'Recovered' } });

    await expect(getPreview({ url })).resolves.toBeNull();
    now.mockReturnValue(30_999);
    await expect(getPreview({ url })).resolves.toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
    now.mockReturnValue(31_000);
    await expect(getPreview({ url })).resolves.toEqual({ title: 'Recovered' });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
