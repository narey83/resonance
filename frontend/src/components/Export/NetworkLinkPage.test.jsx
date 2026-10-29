import api from '../../lib/api';
import NetworkLinkPage from './NetworkLinkPage';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

describe('Bridge setup and revoke', () => {
  let container;
  let click;
  const button = (name) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    );
  const selectSection = async (name) => {
    await act(async () => {
      Simulate.click(button(name));
    });
  };

  const render = async (section = 'Bridges & pairing') => {
    await act(async () => {
      ReactDOM.render(<NetworkLinkPage />, container);
    });
    if (section !== 'Overview') await selectSection(section);
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    jest.useFakeTimers();
    api.get.mockResolvedValue({
      data: { enabled: false, trackCount: 10, helperPlatforms: [] },
    });
    api.post.mockResolvedValue({ data: new Blob(['connection']) });
    api.delete.mockResolvedValue({ data: { revoked: true } });
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, writable: true, value: jest.fn() },
      revokeObjectURL: { configurable: true, writable: true, value: jest.fn() },
    });
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:connection');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation();
    click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it('shows loading instead of reporting no Bridges before status arrives', async () => {
    expect.hasAssertions();
    let finish;
    api.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render('Overview');
    expect(container.textContent).toContain('Loading connected Bridges');
    expect(container.textContent).not.toContain('No Bridge online');
    expect(container.textContent).not.toContain('Pair your first Bridge');
    await act(async () => {
      finish({
        data: {
          connectedBridges: [
            { name: 'Fast Bridge', lastSeen: '2026-10-29T00:00:00Z' },
          ],
        },
      });
    });
    expect(container.textContent).toContain('Fast Bridge');
    expect(container.textContent).toContain('1 online');
    expect(container.textContent).not.toContain('Loading connected Bridges');
  });
  it('polls five seconds after completion without overlapping slow requests', async () => {
    expect.hasAssertions();
    let finish;
    api.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render('Overview');
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ data: { connectedBridges: [] } });
    });
    await act(async () => {
      jest.advanceTimersByTime(4_999);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('recovers from a status failure on the next poll', async () => {
    expect.hasAssertions();
    api.get.mockRejectedValueOnce(new Error('Temporarily unavailable'));
    await render('Overview');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Retrying',
    );
    expect(container.textContent).not.toContain('Pair your first Bridge');
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Pair your first Bridge');
  });
  it('aborts status loading and stops polling when the page closes', async () => {
    expect.hasAssertions();
    await render('Overview');
    const [, options] = api.get.mock.calls[0];
    expect(options.timeout).toBe(15_000);
    expect(options.signal.aborted).toBe(false);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(options.signal.aborted).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('shows only fully analysed readiness in Shared library', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        trackCount: 59_389,
        readyTrackCount: 250,
        readinessMessage:
          '250 fully analysed tracks are ready in 3 resumable batches.',
        helperPlatforms: [],
      },
    });
    await render('Shared library');
    expect(container.textContent).toContain('250fully analysed tracks');
    expect(container.textContent).toContain('59389 indexed tracks');
    expect(container.textContent).toContain('3 resumable batches');
  });
  it('keeps Overview to connection status without pairing, library or support controls', async () => {
    expect.hasAssertions();
    await render('Overview');
    expect(container.textContent).toContain('Waiting for a Bridge');
    expect(button('Download Bridge pairing')).toBeUndefined();
    expect(button('Revoke Bridge connections')).toBeUndefined();
    expect(container.textContent).not.toContain('Ready for Network Link');
    expect(container.textContent).not.toContain('Offline library copy');
    expect(container.textContent).not.toContain('Troubleshooting and support');
  });
  it('keeps connection management in Bridges & pairing', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).toContain('Waiting for a Bridge');
    expect(button('Download Bridge pairing')).toBeDefined();
    expect(container.textContent).not.toContain('Ready for Network Link');
    expect(container.textContent).not.toContain('Get Resonance Bridge');
    expect(container.textContent).not.toContain('Troubleshooting and support');
  });
  it('keeps library preparation in Shared library', async () => {
    expect.hasAssertions();
    await render('Shared library');
    expect(container.textContent).toContain('Ready for Network Link');
    expect(container.textContent).toContain('Offline library copy');
    expect(button('Prepare whole library')).toBeDefined();
    expect(button('Download Bridge pairing')).toBeUndefined();
    expect(container.textContent).not.toContain('Waiting for a Bridge');
    expect(container.textContent).not.toContain('Troubleshooting and support');
  });
  it('puts downloads and diagnostic guidance in Install & support', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { helperPlatforms: ['macos'] } });
    await render('Install & support');
    expect(container.textContent).toContain('Get Resonance Bridge');
    expect(container.textContent).toContain('macOS installer · Apple silicon');
    expect(container.textContent).toContain('Troubleshooting and support');
    expect(container.textContent).toContain('Save diagnostic report');
    expect(container.textContent).not.toContain('Offline library copy');
    expect(button('Download Bridge pairing')).toBeUndefined();
  });
  it('keeps library preparation errors visible in the Shared library tab', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { enabled: true, trackCount: 10 } });
    api.post.mockRejectedValueOnce({
      response: { data: 'Worker unavailable.' },
    });
    await render('Shared library');
    await act(async () => {
      Simulate.click(button('Prepare whole library'));
    });
    expect(api.post).toHaveBeenCalledWith('/bridge');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Worker unavailable.',
    );
  });
  it('allows pairing without a library worker and explains the music limitation', async () => {
    expect.hasAssertions();
    await render();
    expect(button('Download Bridge pairing').disabled).toBe(false);
    expect(container.textContent).toContain(
      'library-preparation worker is not configured',
    );
    expect(api.post).not.toHaveBeenCalled();
  });
  it('shows the identity and address of an online Bridge', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        pairedBridgeCount: 1,
        connectedBridges: [
          {
            pairingId: 'abc123def456',
            name: 'Studio-Mac',
            version: '0.3.6',
            platform: 'darwin',
            architecture: 'arm64',
            address: '192.168.0.178',
            latencyMs: 24,
            lastSeen: '2026-10-29T00:00:00Z',
          },
        ],
      },
    });
    await render();
    expect(container.textContent).toContain('Studio-Mac');
    expect(container.textContent).toContain('192.168.0.178');
    expect(container.textContent).toContain('0.3.6');
    expect(container.textContent).toContain('macOS · arm64');
    expect(container.textContent).toContain('24 ms');
    expect(container.textContent).toContain('1 online');
    await selectSection('Overview');
    expect(
      container.querySelector('[aria-label^="Delete pairing for"]'),
    ).toBeNull();
    expect(container.textContent).toContain('Studio-Mac');
    await selectSection('Bridges & pairing');
    await act(async () => {
      Simulate.click(
        container.querySelector('[aria-label="Delete pairing for Studio-Mac"]'),
      );
    });
    expect(api.delete).toHaveBeenCalledWith('/bridge/connections/abc123def456');
  });
  it('creates an attached file download and shows setup instructions beside the controls', async () => {
    expect.hasAssertions();
    await render();
    click.mockImplementation(() => {
      expect(
        document.querySelector(
          'a[download="resonance-bridge-pairing.resonance"]',
        ),
      ).not.toBeNull();
    });
    await act(async () => {
      Simulate.click(button('Download Bridge pairing'));
    });
    expect(api.post).toHaveBeenCalledWith('/bridge/connection', null, {
      responseType: 'blob',
    });
    expect(container.querySelector('[role="status"]').textContent).toContain(
      'Pairing file ready',
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('shows a clear successful revoke result', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => {
      Simulate.click(button('Revoke Bridge connections'));
    });
    expect(api.delete).toHaveBeenCalledWith('/bridge/connections');
    expect(container.querySelector('[role="status"]').textContent).toContain(
      'Existing pairing files no longer work',
    );
  });
  it('shows a persistence failure instead of claiming revocation succeeded', async () => {
    expect.hasAssertions();
    await render();
    api.delete.mockRejectedValueOnce({
      response: { status: 503, data: 'Cannot save the revocation.' },
    });
    await act(async () => {
      Simulate.click(button('Revoke Bridge connections'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Cannot save the revocation.',
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('decodes a server rejection returned as a JSON-string blob', async () => {
    expect.hasAssertions();
    await render();
    const data = new Blob([]);
    Object.defineProperty(data, 'text', {
      value: jest
        .fn()
        .mockResolvedValue(
          '"Revoke existing Bridge connections before adding another."',
        ),
    });
    api.post.mockRejectedValueOnce({ response: { status: 409, data } });
    await act(async () => {
      Simulate.click(button('Download Bridge pairing'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Revoke existing Bridge connections',
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('explains missing write access and re-enables the controls', async () => {
    expect.hasAssertions();
    await render();
    api.post.mockRejectedValueOnce({ response: { status: 403 } });
    await act(async () => {
      Simulate.click(button('Download Bridge pairing'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'read/write access',
    );
    expect(button('Download Bridge pairing').disabled).toBe(false);
  });
});
