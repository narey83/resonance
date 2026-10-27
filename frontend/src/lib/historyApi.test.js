import api from './api';
import { getTransferAttempts, getTransferHistory } from './reports';

jest.mock('./api', () => ({ get: jest.fn() }));
describe('History API cancellation', () => {
  it('forwards history and attempt cancellation without serializing the signal', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    api.get.mockResolvedValue({ data: [], headers: {} });
    await getTransferHistory({ direction: 'Upload', signal });
    expect(api.get.mock.calls[0][0]).not.toContain('signal=');
    expect(api.get.mock.calls[0][1]).toEqual({ signal });
    await getTransferAttempts('id', { signal });
    expect(api.get).toHaveBeenCalledWith(
      '/telemetry/reports/transfers/history/id/attempts',
      { signal },
    );
  });
});
