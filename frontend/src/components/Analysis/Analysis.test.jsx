import * as analysisApi from '../../lib/analysis';
import { getPreparationStatus } from '../../lib/libraryWorkspace';
import * as musicLibraryApi from '../../lib/musicLibrary';
import { usePagedList } from '../../lib/usePagedList';
import Analysis from './Analysis';
import { useVirtualizer } from '@tanstack/react-virtual';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('@tanstack/react-virtual', () => ({ useVirtualizer: jest.fn() }));
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ play: jest.fn(), track: null }),
}));
jest.mock('../../lib/libraryWorkspace', () => ({
  getPreparationStatus: jest.fn(),
}));

jest.mock(
  '../TrackAnalysis/CandidateAnalysisPanel',
  () =>
    ({ path, resultsOnly }) => (
      <p>
        Result details: {path}, {resultsOnly ? 'read only' : 'editable'}
      </p>
    ),
);
jest.mock('../../lib/usePagedList', () => ({ usePagedList: jest.fn() }));
jest.mock('../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: 0 }),
}));
jest.mock('../../lib/analysis', () => ({
  METRICS: ['Key', 'Bpm'],
  startScan: jest.fn(),
  getScanState: jest.fn(() => Promise.resolve({ scanning: false })),
}));
jest.mock('../../lib/musicLibrary', () => ({
  getAnalysisStats: jest.fn(),
  getFolders: jest.fn(),
  getKeys: jest.fn(() => Promise.resolve([])),
  getTrackPage: jest.fn(),
}));
jest.mock('../../lib/useKeyFormat', () => ({
  useKeyFormat: () => ({ format: 'camelot', fmtKey: (key) => key }),
}));
jest.mock('../Shared/PageInfo', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('./RowWaveform', () => ({ __esModule: true, default: () => null }));

const row = (path) => ({ path, directory: '/music/Album', filename: path });
const folder = (trackCount = 3) => ({
  path: '/music/Album',
  name: 'Album',
  trackCount,
});

describe('analysis folder loading', () => {
  let container;
  let page;
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<Analysis />, container);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    musicLibraryApi.getAnalysisStats.mockResolvedValue({
      total: 3,
      complete: 0,
    });
    getPreparationStatus.mockResolvedValue({
      counts: { complete: 5 },
      paused: true,
      enhancedEnabled: true,
    });
    useVirtualizer.mockImplementation(
      ({ count, getItemKey, scrollMargin }) => ({
        getTotalSize: () => count * 44,
        getVirtualItems: () =>
          Array.from({ length: Math.min(count, 20) }, (_, index) => ({
            index,
            key: getItemKey(index),
            start: scrollMargin + index * 44,
          })),
        measureElement: () => {},
      }),
    );
    analysisApi.getScanState.mockResolvedValue({ scanning: false });
    container = document.createElement('div');
    document.body.append(container);
    page = {
      items: [folder()],
      total: 3,
      loading: false,
      loadingMore: false,
      loadMore: jest.fn(),
      error: null,
    };
    usePagedList.mockImplementation(() => page);
    musicLibraryApi.getTrackPage.mockImplementation(async () => ({
      items: [row('one'), row('two'), row('three')],
      total: 3,
    }));
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('virtualizes results against the page instead of an inner scroll window', async () => {
    expect.hasAssertions();
    await render();
    const options = useVirtualizer.mock.calls.at(-1)[0];
    expect(options.getScrollElement()).toBe(
      container.querySelector('.ka-root'),
    );
    expect(options.getScrollElement()).not.toBe(
      container.querySelector('.ka-track-list'),
    );
    expect(options.scrollMargin).toBe(0);
    expect(
      container.querySelector('.ka-track-list [data-index="0"]').style
        .transform,
    ).toBe('translateY(0px)');
  });

  it('waits for initial loading and keeps results aligned when the analysis controls resize', async () => {
    expect.hasAssertions();
    const previousObserver = global.ResizeObserver;
    let resize;
    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: jest.fn((callback) => {
        resize = callback;
        return { observe: jest.fn(), disconnect: jest.fn() };
      }),
    });
    try {
      page = { ...page, items: [], loading: true };
      await render();
      expect(global.ResizeObserver).not.toHaveBeenCalled();
      page = { ...page, items: [folder()], loading: false };
      await render();
      let top = 550;
      Object.defineProperty(
        container.querySelector('.ka-track-list'),
        'offsetTop',
        {
          configurable: true,
          get: () => top,
        },
      );
      act(() => resize());
      expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(550);
      top = 900;
      act(() => resize());
      expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(900);
      expect(
        container.querySelector('.ka-track-list [data-index="0"]').style
          .transform,
      ).toBe('translateY(0px)');
      top = 550;
      act(() => resize());
      expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(550);
    } finally {
      Object.defineProperty(global, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: previousObserver,
      });
    }
  });

  it('separates basic coverage, enhanced features and preparation queue counts', async () => {
    expect.hasAssertions();
    musicLibraryApi.getAnalysisStats.mockResolvedValue({
      total: 100,
      keyed: 90,
      bpmed: 80,
      waveformed: 70,
      loudness: 60,
      complete: 50,
      enhanced: {
        saved: 20,
        complete: 12,
        unindexed: 0,
        features: {
          beats: 19,
          downbeats: 18,
          vocals: 17,
          stems: 16,
          sections: 15,
          phrases: 14,
          genre: 13,
          energy: 12,
          cues: 11,
          loops: 10,
          similarity: 9,
        },
      },
    });
    getPreparationStatus.mockResolvedValue({
      paused: true,
      enhancedEnabled: true,
      counts: { queued: 7, running: 2, retrying: 3, failed: 4 },
    });
    await render();
    const basic = container.querySelector(
      '[aria-label="Basic analysis coverage"]',
    );
    const enhanced = container.querySelector(
      '[aria-label="Enhanced feature coverage"]',
    );
    const queue = container.querySelector(
      '[aria-label="Preparation queue status"]',
    );
    expect(basic.textContent).toContain('90Key');
    expect(basic.textContent).not.toContain('Beat grids');
    expect(enhanced.textContent).toContain('19Beat grids');
    expect(enhanced.textContent).toContain('17Vocals');
    expect(enhanced.textContent).toContain('12 ready · 88 incomplete');
    expect(queue.textContent).toContain('7queued');
    expect(queue.textContent).toContain('2running');
    expect(queue.textContent).toContain('4failed');
    expect(container.querySelector('details.ka-analysis-help').open).toBe(
      false,
    );
  });

  it('omits the key display controls, key filter and their unused summary request', async () => {
    expect.hasAssertions();
    musicLibraryApi.getKeys.mockResolvedValue([{ key: 'Am', trackCount: 42 }]);
    await render();
    expect(musicLibraryApi.getKeys).not.toHaveBeenCalled();
    expect(container.querySelector('.ka-toolbar select')).toBeNull();
    expect(
      container.querySelector('[aria-label="Key display format"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('Camelot');
    expect(container.textContent).not.toContain('Musical');
    expect(container.querySelector('.ka-summary-basic').textContent).toContain(
      'Key',
    );
  });

  it('only highlights the preparation queue while work is running, not merely queued', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      counts: { queued: 59_376, running: 0 },
    });
    await render();
    expect(container.querySelector('.ka-summary-queue--running')).toBeNull();
    act(() => ReactDOM.unmountComponentAtNode(container));
    getPreparationStatus.mockResolvedValue({
      counts: { queued: 7, running: 2 },
    });
    await render();
    expect(
      container.querySelector('.ka-summary-queue--running'),
    ).not.toBeNull();
  });
  it('highlights manual analysis and stops highlighting when polling reports completion', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 3,
        analysed: 0,
        skipped: 0,
        failed: 0,
        progress: 0,
      });
      await render();
      expect(
        container.querySelector('.ka-summary-queue--running'),
      ).not.toBeNull();
      analysisApi.getScanState.mockResolvedValue({ scanning: false });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(container.querySelector('.ka-summary-queue--running')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
  it('formats large coverage and queue counts consistently', async () => {
    expect.hasAssertions();
    musicLibraryApi.getAnalysisStats.mockResolvedValue({
      total: 59_413,
      complete: 1_679,
      enhanced: { complete: 35, unindexed: 0, features: { beats: 35 } },
    });
    getPreparationStatus.mockResolvedValue({ counts: { queued: 59_376 } });
    await render();
    expect(container.querySelector('.ka-summary-basic').textContent).toContain(
      '59,413Tracks',
    );
    expect(container.querySelector('.ka-summary-basic').textContent).toContain(
      '57,734Incomplete',
    );
    expect(
      container.querySelector('.ka-summary-enhanced').textContent,
    ).toContain('35 ready · 59,378 incomplete');
    expect(container.querySelector('.ka-summary-queue').textContent).toContain(
      '59,376queued',
    );
  });

  it('shows unknown feature coverage while older saved results are being indexed', async () => {
    expect.hasAssertions();
    musicLibraryApi.getAnalysisStats.mockResolvedValue({
      total: 100,
      complete: 10,
      enhanced: {
        saved: 5,
        complete: 5,
        unindexed: 2,
        features: { beats: 3, vocals: 0 },
      },
    });
    await render();
    const enhanced = container.querySelector(
      '[aria-label="Enhanced feature coverage"]',
    );
    expect(enhanced.textContent).toContain('3+Beat grids');
    expect(enhanced.textContent).toContain('—Vocals');
    expect(enhanced.textContent).toContain('2 older saved results');
  });

  it('shows complete folder totals without downloading any tracks', async () => {
    expect.hasAssertions();
    page = {
      ...page,
      items: [
        folder(25_330),
        { path: '/music/Other', name: 'Other', trackCount: 34_083 },
      ],
    };
    await render();
    expect(container.querySelector('.ka-count').textContent).toContain(
      '59,413 tracks',
    );
    expect(container.querySelectorAll('.ka-folder-badge')[0].textContent).toBe(
      '25,330 tracks',
    );
    expect(container.querySelectorAll('.ka-folder-badge')[1].textContent).toBe(
      '34,083 tracks',
    );
    expect(musicLibraryApi.getTrackPage).not.toHaveBeenCalled();
    expect(page.loadMore).not.toHaveBeenCalled();
  });

  it('keeps folder metadata errors visible and retries without fetching track dumps', async () => {
    expect.hasAssertions();
    page.error = new Error('network unavailable');
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () =>
      container.querySelector('.ka-load-error .ka-btn').click(),
    );
    expect(usePagedList.mock.calls.at(-1)[2].refreshToken).toBe(1);
    expect(musicLibraryApi.getTrackPage).not.toHaveBeenCalled();
  });

  it('keeps a missing-package scan failure visible after the scan has stopped', async () => {
    expect.hasAssertions();
    const error =
      'Basic analysis stopped: Essentia and NumPy packages are missing.';
    analysisApi.getScanState.mockResolvedValue({
      scanning: false,
      completed: false,
      failed: 1,
      analysed: 0,
      dependencyUnavailable: true,
      error,
    });
    await render();
    await act(async () =>
      container.querySelector('.ka-folder-scan-btn').click(),
    );
    expect(container.querySelector('[role="alert"]').textContent).toBe(error);
    expect(container.textContent).not.toContain('Scan complete');
  });

  it('does not loop when a folder changes before its track window arrives', async () => {
    expect.hasAssertions();
    musicLibraryApi.getTrackPage.mockResolvedValue({ items: [], total: 0 });
    await render();
    await act(async () => container.querySelector('.ka-folder-expand').click());
    expect(musicLibraryApi.getTrackPage).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('This folder changed');
  });

  it('retries a failed visible track window without hiding the folder totals', async () => {
    expect.hasAssertions();
    musicLibraryApi.getTrackPage.mockRejectedValueOnce(new Error('offline'));
    await render();
    await act(async () => container.querySelector('.ka-folder-expand').click());
    expect(container.querySelector('.ka-folder-badge').textContent).toBe(
      '3 tracks',
    );
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not load these tracks',
    );
    await act(async () =>
      container.querySelector('.ka-track-placeholder .ka-btn').click(),
    );
    expect(musicLibraryApi.getTrackPage).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.ka-track')).toHaveLength(3);
  });

  it('discards a pending old track window when the readiness filter changes', async () => {
    expect.hasAssertions();
    const pending = [];
    musicLibraryApi.getTrackPage.mockImplementation(
      (query, { signal }) =>
        new Promise((resolve) => {
          pending.push({ query, signal, resolve });
        }),
    );
    await render();
    await act(async () => container.querySelector('.ka-folder-expand').click());
    await act(async () =>
      [...container.querySelectorAll('.ka-filter-btn')]
        .find((button) => button.textContent === 'Basic incomplete')
        .click(),
    );
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].query.analysis).toBe('incomplete');
    await act(async () => {
      pending[0].resolve({ items: [row('stale')], total: 3 });
      pending[1].resolve({
        items: [row('fresh'), row('two'), row('three')],
        total: 3,
      });
    });
    expect(container.textContent).toContain('fresh');
    expect(container.textContent).not.toContain('stale');
  });

  it('refreshes only the visible track window while keeping full folder counts', async () => {
    expect.hasAssertions();
    page = { ...page, items: [folder(25_330)] };
    musicLibraryApi.getTrackPage.mockResolvedValue({
      items: Array.from({ length: 200 }, (_, index) => row(String(index))),
      total: 25_330,
    });
    await render();
    const refreshTracks = container.querySelector(
      '.ka-toolbar [title="Refresh tracks"]',
    );
    expect(refreshTracks.textContent).toContain('Refresh tracks');
    expect(
      container.querySelector('.ka-analysis-actions [title="Refresh tracks"]'),
    ).toBeNull();
    expect(container.querySelector('.ka-analysis-actions')).toBeNull();
    await act(async () => container.querySelector('.ka-folder-expand').click());
    await act(async () => refreshTracks.click());
    expect(analysisApi.startScan).not.toHaveBeenCalled();
    expect(musicLibraryApi.getTrackPage).toHaveBeenCalledTimes(2);
    expect(
      musicLibraryApi.getTrackPage.mock.calls.map(([query]) => ({
        folder: query.folder,
        limit: query.limit,
      })),
    ).toEqual([
      { folder: '/music/Album', limit: 200 },
      { folder: '/music/Album', limit: 200 },
    ]);
    expect(container.querySelector('.ka-folder-badge').textContent).toBe(
      '25,330 tracks',
    );
    expect(container.querySelectorAll('.ka-track')).toHaveLength(19);
  });

  it('keeps a 5000-track folder bounded to visible rows and selects the whole folder', async () => {
    expect.hasAssertions();
    page = { ...page, items: [folder(5_000)] };
    musicLibraryApi.getTrackPage.mockImplementation(
      async ({ limit, offset }) => ({
        items: Array.from(
          { length: Math.min(limit, 5_000 - offset) },
          (_, index) => row(String(offset + index)),
        ),
        total: 5_000,
      }),
    );
    await render();
    await act(async () => container.querySelector('.ka-folder-expand').click());
    expect(container.querySelectorAll('.ka-track')).toHaveLength(19);
    expect(musicLibraryApi.getTrackPage).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: '/music/Album',
        recursive: false,
        limit: 200,
        offset: 0,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.querySelector('.ka-folder-badge').textContent).toBe(
      '5,000 tracks',
    );
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    expect(container.querySelector('.ka-col-check input').title).toBe(
      '5000 selected',
    );
    expect(container.querySelectorAll('.ka-track--selected')).toHaveLength(19);
  });
  it('scans every track in a folder beyond the server 10000-track response limit', async () => {
    expect.hasAssertions();
    musicLibraryApi.getTrackPage.mockImplementation(({ limit, offset }) =>
      Promise.resolve({
        items: Array.from(
          { length: Math.min(limit, 10_001 - offset) },
          (_, index) => row(String(offset + index)),
        ),
        total: 10_001,
      }),
    );
    await render();
    await act(async () => {
      container.querySelector('.ka-folder-scan-btn').click();
    });
    expect(musicLibraryApi.getTrackPage).toHaveBeenCalledTimes(2);
    expect(analysisApi.startScan.mock.calls[0][0].onlyPaths).toHaveLength(
      10_001,
    );
  });
  it('clears an old selection when switching between Basic and Enhanced readiness results', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      [...container.querySelectorAll('.ka-filter-btn')]
        .find((button) => button.textContent === 'Basic ready')
        .click(),
    );
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    expect(container.querySelector('.ka-col-check input').title).toBe(
      '3 selected',
    );
    await act(async () =>
      container.querySelector('input[value="enhanced"]').click(),
    );
    expect(container.querySelector('.ka-col-check input').title).toBe(
      'Select all visible',
    );
    expect(usePagedList.mock.calls.at(-1)[1].analysis).toBe('enhanced');
  });

  it('always shows analysis settings with no top Analyse or close button and shares one mode selector', async () => {
    expect.hasAssertions();
    page = { ...page, items: [folder()] };
    await render();
    expect(analysisApi.startScan).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Analysis settings"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll('[name="analysis-mode"]')).toHaveLength(
      2,
    );
    expect(container.querySelector('input[value="basic"]').checked).toBe(true);
    expect(container.querySelector('.ka-analysis-actions')).toBeNull();
    expect(
      container.querySelector('[aria-label="Close analysis settings"]'),
    ).toBeNull();
    expect(container.querySelector('.ka-panel select')).toBeNull();
    expect(container.querySelector('.ka-panel').textContent).toContain(
      'Selected mode: Basic',
    );
    expect(
      container.querySelector('.ka-panel .ka-btn--primary').textContent,
    ).toContain('Start Basic analysis');
    expect(container.querySelector('.ka-panel .ka-btn--primary').disabled).toBe(
      true,
    );
    await act(async () =>
      container.querySelector('.ka-panel .ka-btn--primary').click(),
    );
    expect(analysisApi.startScan).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    expect(container.querySelector('.ka-panel .ka-btn--primary').disabled).toBe(
      false,
    );
    await act(async () => {
      container.querySelector('.ka-panel .ka-btn--primary').click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enhanced: false,
        onlyPaths: ['one', 'two', 'three'],
      }),
    );

    expect(
      container.querySelector('[aria-label="Analysis settings"]'),
    ).not.toBeNull();
    act(() => container.querySelector('input[value="enhanced"]').click());
    expect(container.querySelector('.ka-panel select')).toBeNull();
    expect(container.querySelector('.ka-panel').textContent).toContain(
      'Selected mode: Enhanced',
    );
    expect(
      container.querySelector('.ka-panel .ka-btn--primary').textContent,
    ).toContain('Analyse 3 selected');
    await act(async () => {
      container.querySelector('.ka-panel .ka-btn--primary').click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enhanced: true,
        onlyPaths: ['one', 'two', 'three'],
      }),
    );
  });
  it('blocks empty selections in both modes including reset and after deselecting', async () => {
    expect.hasAssertions();
    await render();
    const expectEmptySelectionBlocked = async () => {
      const button = container.querySelector('.ka-panel .ka-btn--primary');
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
      expect(analysisApi.startScan).not.toHaveBeenCalled();
    };

    await expectEmptySelectionBlocked();
    act(() => container.querySelector('input[value="enhanced"]').click());
    await expectEmptySelectionBlocked();
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    expect(container.querySelector('.ka-panel .ka-btn--primary').disabled).toBe(
      false,
    );
    act(() =>
      container
        .querySelector('[aria-label="Reset & reanalyse selected tracks"]')
        .click(),
    );
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    const start = container.querySelector('.ka-panel .ka-btn--primary');
    expect(start.disabled).toBe(true);
    await act(async () => start.click());
    expect(analysisApi.startScan).not.toHaveBeenCalled();
  });
  it('preserves scan options when changing the shared analysis mode', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      container.querySelector('.ka-folder-check input').click(),
    );
    const skip = container.querySelector(
      '[role="switch"][aria-label="Skip already-analysed tracks"]',
    );
    const reset = container.querySelector(
      '[role="switch"][aria-label="Reset & reanalyse selected tracks"]',
    );
    expect(skip.getAttribute('aria-checked')).toBe('true');
    expect(reset.getAttribute('aria-checked')).toBe('false');
    act(() => reset.closest('label').querySelector('.ka-field-label').click());
    expect(skip.getAttribute('aria-checked')).toBe('false');
    expect(reset.getAttribute('aria-checked')).toBe('true');
    act(() => container.querySelector('input[value="enhanced"]').click());
    act(() => container.querySelector('input[value="basic"]').click());
    expect(container.querySelector('.ka-panel').textContent).toContain(
      'Selected mode: Basic',
    );
    expect(container.querySelector('.ka-warn')).not.toBeNull();
    await act(async () =>
      container.querySelector('.ka-panel .ka-btn--primary').click(),
    );
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enhanced: false,
        resetAll: true,
        skipAnalysed: false,
      }),
    );
  });
  it('uses the visible enhanced option for folder scans and enhanced readiness filters', async () => {
    expect.hasAssertions();
    page = { ...page, items: [folder()] };
    await render();
    expect(container.querySelector('input[value="basic"]').checked).toBe(true);
    act(() => container.querySelector('input[value="enhanced"]').click());
    await act(async () =>
      container.querySelector('.ka-folder-scan-btn').click(),
    );
    expect(analysisApi.startScan).toHaveBeenCalledWith(
      expect.objectContaining({
        enhanced: true,
        onlyPaths: ['one', 'two', 'three'],
      }),
    );
    act(() =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent === 'Enhanced ready')
        .click(),
    );
    expect(usePagedList.mock.calls.at(-1)[1].analysis).toBe('enhanced');
  });
  it('opens details on demand and keeps saved and enhanced BPM/key separate', async () => {
    expect.hasAssertions();
    const detailedTracks = [
      {
        ...row('one'),
        title: 'Test track',
        bpm: 130,
        key: 'G',
        hasWaveform: true,
        lufs: -8,
        djSummary: JSON.stringify({
          complete: true,
          bpm: 129.8,
          key: 'Gm',
          analysisId: 'full-job',
        }),
      },
    ];
    page = { ...page, items: [folder(1)] };
    musicLibraryApi.getTrackPage.mockResolvedValue({
      items: detailedTracks,
      total: 1,
    });
    await render();
    expect(container.textContent).not.toContain('Result details:');
    await act(async () => container.querySelector('.ka-folder-expand').click());
    act(() =>
      container
        .querySelector('[aria-label="Analysis details for Test track"]')
        .click(),
    );
    const details = container.querySelector(
      '[aria-label="Track analysis details"]',
    );
    expect(details.textContent).toContain('130');
    expect(details.textContent).toContain('129.8 / Gm');
    expect(details.textContent).toContain('Result details: one, read only');
    expect(analysisApi.startScan).not.toHaveBeenCalled();
    act(() =>
      container.querySelector('[aria-label="Close analysis details"]').click(),
    );
    expect(
      container.querySelector('[aria-label="Track analysis details"]'),
    ).toBeNull();
  });
  it('shows active enhanced progress, worker readiness and mode coverage', async () => {
    expect.hasAssertions();
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      enhancedTotal: 20,
      enhancedCompleted: 5,
      enhancedFailed: 2,
      total: 0,
      analysed: 0,
      skipped: 0,
      failed: 0,
    });
    await render();
    const progress = container.querySelector(
      '[aria-label="Enhanced tracks processed"]',
    );
    expect(progress.max).toBe(20);
    expect(progress.value).toBe(7);
    expect(container.querySelector('input[value="enhanced"]').checked).toBe(
      true,
    );
    expect(container.textContent).toContain('5 / 20 ready');
    expect(container.textContent).toContain('13 remaining');
    expect(container.textContent).toContain('Some tracks need attention');
    expect(container.textContent).toContain('beat and downbeat grids');
    expect(container.textContent).toContain('Automatic preparation: Paused');
    expect(container.textContent).toContain('Enhanced worker: Available');
  });
});
