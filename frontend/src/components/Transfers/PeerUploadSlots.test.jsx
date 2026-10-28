import { getInfo } from '../../lib/users';
import PeerUploadSlots from './PeerUploadSlots';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/users', () => ({ getInfo: jest.fn() }));

describe('Peer upload slots', () => {
  let container;
  beforeEach(() => {
    jest.resetAllMocks();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (username = 'peer') => {
    await act(async () => {
      ReactDOM.render(<PeerUploadSlots username={username} />, container);
    });
  };

  it('shows total slots, availability and the peer queue without inventing a free count', async () => {
    expect.hasAssertions();
    getInfo.mockResolvedValue({
      data: { uploadSlots: 3, hasFreeUploadSlot: false, queueLength: 19 },
    });
    await render();
    expect(container.textContent).toContain(
      '3 upload slots · no free slots · 19 queued at peer',
    );
    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(getInfo.mock.calls[0][0].timeout).toBe(15_000);
  });
  it('preserves zero slots and an empty queue', async () => {
    expect.hasAssertions();
    getInfo.mockResolvedValue({
      data: { uploadSlots: 0, hasFreeUploadSlot: true, queueLength: 0 },
    });
    await render();
    expect(container.textContent).toContain(
      '0 upload slots · slot available · 0 queued at peer',
    );
  });
  it('shows unavailable on failure and supports a manual retry', async () => {
    expect.hasAssertions();
    getInfo.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({
      data: { uploadSlots: 1, hasFreeUploadSlot: true, queueLength: 0 },
    });
    await render();
    expect(container.textContent).toContain('Upload slots unavailable');
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(container.textContent).toContain('1 upload slot · slot available');
    expect(getInfo).toHaveBeenCalledTimes(2);
  });
  it('does not interpret missing or malformed values as zero or busy', async () => {
    expect.hasAssertions();
    getInfo.mockResolvedValue({ data: { uploadSlots: -1, queueLength: null } });
    await render();
    expect(container.textContent).toContain(
      'Upload slots unknown · availability unknown',
    );
    expect(container.textContent).not.toContain('queued at peer');
  });
  it('cancels obsolete requests and ignores a late response from a previous user', async () => {
    expect.hasAssertions();
    let resolveOld;
    getInfo
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValue({
        data: { uploadSlots: 2, hasFreeUploadSlot: true, queueLength: 0 },
      });
    await render('old');
    expect(container.querySelector('button').disabled).toBe(true);
    const signal = getInfo.mock.calls[0][0].signal;
    await render('new');
    expect(signal.aborted).toBe(true);
    await act(async () => resolveOld({ data: { uploadSlots: 9 } }));
    expect(container.textContent).toContain('2 upload slots');
    expect(container.textContent).not.toContain('9 upload slots');
  });
});
