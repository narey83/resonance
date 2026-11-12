import api from '../../lib/api';
import UsbExportInspector from './UsbExportInspector';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));
const job = {
  jobId: 'a'.repeat(32),
  playlistName: 'Test playlist',
  total: 1,
  status: 'completed',
  downloadAvailable: true,
};
const report = {
  playlistName: 'Test playlist',
  profile: 'dual',
  fileCount: 4,
  totalBytes: 1_024,
  audioPolicy: 'Prepared on server',
  hardwareVerified: false,
  databases: [
    {
      path: 'PIONEER/rekordbox/export.pdb',
      bytes: 1_024,
      sha256: 'b'.repeat(64),
      matchesManifest: true,
    },
  ],
  playlists: [{ id: 1, name: 'Read from DB', trackIds: [7] }],
  tracks: [
    {
      id: 7,
      title: 'Stored title',
      artist: 'Artist',
      album: 'Album',
      bpm: 123,
      key: 'Am',
      durationSeconds: 4,
      bitDepth: 16,
      sampleRate: 44_100,
      bytes: 1_024,
      path: '/Contents/track.wav',
      analysisPath: '/PIONEER/track.DAT',
    },
  ],
  oneLibrary: {
    tracks: 1,
    integrity: 'ok',
    tracksMatchLegacy: true,
    playlistOrderMatchesLegacy: true,
  },
};
describe('Saved export database inspection', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockImplementation((url) =>
      Promise.resolve({ data: url.endsWith('/history') ? [job] : report }),
    );
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
  });
  const open = async () => {
    await act(async () => {
      const details = container.querySelector('details');
      details.open = true;
      Simulate.toggle(details);
    });
  };

  it('loads history only when opened and shows database records with the saved export ID', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportInspector />, container);
    });
    expect(api.get).not.toHaveBeenCalled();
    await open();
    expect(api.get).toHaveBeenCalledWith('/analysis/usb-export/history');
    await act(async () =>
      Simulate.change(container.querySelector('select'), {
        target: { value: job.jobId },
      }),
    );
    expect(api.get).toHaveBeenCalledWith(
      `/analysis/usb-export/${job.jobId}/inspection`,
    );
    expect(container.textContent).toContain(job.jobId);
    expect(container.textContent).toContain('Stored title');
    expect(container.textContent).toContain('Read from DB');
    expect(container.textContent).toContain('Checksum matches export manifest');
    expect(container.textContent).toContain(
      'Hardware playback: not yet verified',
    );
  });
  it('can defer a saved export and keep it available to reopen', async () => {
    expect.hasAssertions();
    api.post.mockResolvedValue({ data: { ...job, deferred: true } });
    await act(async () => {
      ReactDOM.render(<UsbExportInspector />, container);
    });
    await open();
    await act(async () =>
      Simulate.change(container.querySelector('select'), {
        target: { value: job.jobId },
      }),
    );
    const defer = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Defer export',
    );
    await act(async () => Simulate.click(defer));
    expect(api.post).toHaveBeenCalledWith(
      `/analysis/usb-export/${job.jobId}/defer`,
    );
    expect(container.querySelector('select').textContent).toContain(
      'saved for later',
    );
    expect(container.textContent).toContain('Open in Resonance Bridge');
  });
  it('clears an old report when selecting another export that fails to load', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportInspector />, container);
    });
    await open();
    await act(async () =>
      Simulate.change(container.querySelector('select'), {
        target: { value: job.jobId },
      }),
    );
    api.get.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () =>
      Simulate.change(container.querySelector('select'), {
        target: { value: 'c'.repeat(32) },
      }),
    );
    expect(container.textContent).not.toContain('Stored title');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not read',
    );
  });
  it('shows an empty state and a recoverable history failure', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({ data: [] });
    await act(async () => {
      ReactDOM.render(<UsbExportInspector />, container);
    });
    await open();
    expect(container.textContent).toContain('No saved exports');
    await act(async () => {
      const details = container.querySelector('details');
      details.open = false;
      Simulate.toggle(details);
    });
    api.get.mockRejectedValueOnce(new Error('offline'));
    await open();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not load saved exports',
    );
  });
});
