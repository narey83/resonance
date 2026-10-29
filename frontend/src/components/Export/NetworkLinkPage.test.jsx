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
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<NetworkLinkPage />, container);
    });
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
  it('shows only fully analysed readiness and explains support reports', async () => {
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
    await render();
    expect(container.textContent).toContain('250fully analysed tracks');
    expect(container.textContent).toContain('59389 indexed tracks');
    expect(container.textContent).toContain('Save diagnostic report');
    expect(container.textContent).toContain('3 resumable batches');
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
