import api from './api';
import { saveNotification } from './events';

jest.mock('./api', () => ({ post: jest.fn() }));

describe('persisted action notices', () => {
  it('returns the database identity and timestamp for the displayed notice', async () => {
    expect.hasAssertions();
    const saved = { id: 'saved-id', timestamp: '2026-11-02T20:00:00Z' };
    api.post.mockResolvedValue({ data: saved });
    await expect(
      saveNotification({ type: 'ActionSuccess', message: 'Done' }),
    ).resolves.toEqual(saved);
    expect(api.post).toHaveBeenCalledWith('/events/notifications', {
      type: 'ActionSuccess',
      message: 'Done',
    });
  });

  it('exposes save failures so the UI can label a temporary notice', async () => {
    expect.hasAssertions();
    api.post.mockRejectedValue(new Error('Offline'));
    await expect(
      saveNotification({ type: 'ActionError', message: 'Failed' }),
    ).rejects.toThrow('Offline');
  });
});
