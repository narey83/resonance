import StatusStrip from './StatusStrip';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/* eslint-disable unicorn/consistent-function-scoping -- Jest mock factories must be self-contained. */
jest.mock('../MetadataLookup/MetadataLookupWatcher', () => () => null);
jest.mock('../../lib/useTransferRates', () => () => ({
  down: 125_000,
  up: 250_000,
}));
/* eslint-enable unicorn/consistent-function-scoping */

const renderPanel = (props = {}) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<StatusStrip {...props} />);
  return container.querySelector('.status-details-panel');
};

describe('Status and controls explanations', () => {
  it('labels server metrics and distinguishes waiting transfers', () => {
    const panel = renderPanel({
      disk: { totalBytes: 2_000, availableBytes: 1_000 },
      system: {
        hostMemoryTotalBytes: 4_000,
        hostMemoryUsedBytes: 2_000,
        hostCpuPercent: 88,
      },
      shares: { files: 42, directories: 3 },
      downloads: [{ state: 'Queued' }, { state: 'InProgress' }],
      uploads: [{ state: 'Requested' }],
      networkInfo: { ip: '192.0.2.1', isp: 'Example ISP' },
      viewControls: <button type="button">Auto size</button>,
    });
    for (const label of [
      'Shared collection',
      'Waiting transfers',
      '2 queued',
      'Download:',
      'Upload:',
      'Download storage',
      'CPU: 88%',
      'Memory:',
      'Server public IP address',
    ]) {
      expect(panel.textContent).toContain(label);
    }

    expect(
      panel.querySelector('[aria-label="Rescan shared files"]'),
    ).not.toBeNull();
    expect(panel.textContent).toContain('3 folders');
  });

  it('labels the top-bar count as file transfers', () => {
    const panel = renderPanel({ queuedTransferCount: 42 });
    expect(
      panel.closest('.status-strip').querySelector('.status-chip').textContent,
    ).toContain('42 transfers queued');
  });

  it('links separate upload and download waiting counts to their queues', () => {
    const panel = renderPanel({
      queuedTransferCount: 13_150,
      queuedTransferCounts: { uploads: 13_143, downloads: 7 },
    });
    const bar = panel.closest('.status-strip');
    expect(
      bar.querySelector('a[href="/uploads"]').getAttribute('aria-label'),
    ).toBe('13,143 uploads waiting');
    expect(
      bar.querySelector('a[href="/downloads"]').getAttribute('aria-label'),
    ).toBe('7 downloads waiting');
    expect(bar.querySelectorAll('.status-transfer-link strong')).toHaveLength(
      2,
    );
    expect(
      bar.querySelector('[aria-label="Waiting transfers"]'),
    ).not.toBeNull();
    expect(bar.textContent).not.toContain('13150 transfers queued');
  });

  it('shows a personal Soulseek tag when one is set', () => {
    localStorage.setItem(
      'resonance-status-profile',
      JSON.stringify({ description: 'Sharing good music' }),
    );
    try {
      const panel = renderPanel({
        isLoggedIn: true,
        server: { isLoggedIn: true },
        user: { username: 'MusicFan' },
      });
      const tag = panel
        .closest('.status-strip')
        .querySelector('.status-comment-chip');
      expect(tag.textContent).toBe('Sharing good music');
      expect(tag.title).toBe('Sharing good music');
      const button = panel
        .closest('.status-strip')
        .querySelector('.status-strip-username-btn');
      expect(button.textContent).toBe('MusicFanOnlineSharing good music');
    } finally {
      localStorage.removeItem('resonance-status-profile');
    }
  });

  it.each([
    [true, 'Online', 'Online'],
    [true, 'Away', 'Away'],
    [false, 'Away', 'Offline'],
  ])(
    'shows connection %s and presence %s as %s',
    (connected, presence, expected) => {
      localStorage.setItem(
        'resonance-status-profile',
        JSON.stringify({ presence }),
      );
      try {
        const panel = renderPanel({
          isLoggedIn: true,
          server: { isLoggedIn: connected },
          user: { username: 'MusicFan' },
        });
        const status = panel
          .closest('.status-strip')
          .querySelector('.status-account-presence');
        expect(status.textContent).toBe(expected);
      } finally {
        localStorage.removeItem('resonance-status-profile');
      }
    },
  );

  it('keeps transfer speeds inside Options rather than the top bar', () => {
    const panel = renderPanel({
      downloads: [{ state: 'InProgress', averageSpeed: 125_000 }],
      uploads: [{ state: 'InProgress', averageSpeed: 250_000 }],
    });
    const bar = panel.closest('.status-strip');
    expect(bar.querySelector('.status-live-rates')).toBeNull();
    expect(panel.textContent).toContain('Current transfer speed');
    expect(panel.textContent).toContain('Download:');
    expect(panel.textContent).toContain('Upload:');
  });

  it('uses the whole-queue counter with only active byte samples', () => {
    const panel = renderPanel({
      queuedTransferCount: 35_007,
      uploads: [{ id: 'active', state: 'InProgress', bytesTransferred: 42 }],
    });
    expect(panel.textContent).toContain('35007 queued');
  });

  it('preserves an explicit zero instead of counting stale samples', () => {
    const panel = renderPanel({
      queuedTransferCount: 0,
      uploads: [{ state: 'Queued' }],
    });
    expect(panel.textContent).toContain('No transfers waiting');
  });

  it('keeps display size in the top bar and restart out of the dropdown', () => {
    const panel = renderPanel({
      viewControls: <button type="button">Auto size</button>,
    });
    const bar = panel.closest('.status-strip');
    expect(panel.textContent).not.toContain('Display size');
    expect(panel.textContent).not.toContain('Restart server');
    expect(
      bar.querySelector('.status-strip-view-controls').textContent,
    ).toContain('Display size');
    expect(
      bar.querySelector('.status-strip-view-controls').textContent,
    ).toContain('Auto size');
    expect(panel.querySelector('.status-strip-view-controls')).toBeNull();
  });

  it('handles absent server metrics and an empty queue', () => {
    const panel = renderPanel();
    expect(panel.textContent).toContain('No transfers waiting');
    expect(panel.textContent).not.toContain('Download storage');
    expect(panel.textContent).not.toContain('Server resources');
    expect(panel.textContent).not.toContain('undefined');
  });

  it('explains uncertain incoming connections when router and public IP differ', () => {
    localStorage.setItem(
      'resonance-status-port',
      JSON.stringify({ isOpen: true, port: 50_300 }),
    );
    const panel = renderPanel({
      server: { isLoggedIn: true },
      upnp: { isMapped: true, externalIPAddress: '192.0.2.2' },
      networkInfo: { ip: '192.0.2.1' },
    });
    localStorage.removeItem('resonance-status-port');
    expect(panel.textContent).toContain('Reachability uncertain');
  });
});
