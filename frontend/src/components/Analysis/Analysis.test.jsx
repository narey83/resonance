import { useLibraryActivity } from '../../context/LibraryActivityContext';
import * as analysisApi from '../../lib/analysis';
import {
  getPreparationStatus,
  pausePreparation,
} from '../../lib/libraryWorkspace';
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
  pausePreparation: jest.fn(),
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
  useLibraryActivity: jest.fn(() => ({ libraryRevision: 0 })),
}));
jest.mock('../../lib/analysis', () => ({
  METRICS: ['Key', 'Bpm'],
  startScan: jest.fn(),
  cancelScan: jest.fn(),
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
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(<Analysis {...props} />, container);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useLibraryActivity.mockReturnValue({ libraryRevision: 0 });
    pausePreparation.mockResolvedValue({});
    analysisApi.cancelScan.mockResolvedValue({});
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

  it('organises readiness, current work and selection with secondary details collapsed', async () => {
    expect.hasAssertions();
    await render();
    expect(
      [...container.querySelectorAll('.ka-section-title')].map(
        (e) => e.textContent,
      ),
    ).toEqual(['Library readiness', 'Current analysis']);
    expect(container.querySelector('.ka-readiness').textContent).toContain(
      'Basic ready',
    );
    expect(container.querySelector('.ka-readiness').textContent).toContain(
      'Enhanced ready',
    );
    expect(container.querySelector('.ka-coverage-details').open).toBe(false);
    expect(container.querySelector('.ka-automatic-details').open).toBe(false);
    expect(container.querySelector('[aria-label="Data freshness"]').open).toBe(
      false,
    );
    expect(
      container.querySelector(
        '.ka-current-analysis [aria-label="Stop analysis"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('.ka-panel .ka-analysis-modes'),
    ).not.toBeNull();
    expect(
      container.querySelector('.ka-overview .ka-analysis-modes'),
    ).toBeNull();
    expect(container.querySelector('.ka-panel-header').textContent).toBe(
      'Choose music to analyse',
    );
  });
  it('restores selection, expanded folders, mode and options after leaving the view', async () => {
    expect.hasAssertions();
    const viewState = {
      current: {
        search: 'Album',
        filter: 'all',
        sortKey: 'title',
        sortDirection: 'asc',
        selected: new Map([['one', '/music/Album']]),
        expandedFolders: new Set(['/music/Album']),
        enhanced: true,
        skipTagged: false,
        resetAll: true,
      },
    };
    await render({ viewState });
    expect(container.querySelector('.ka-search').value).toBe('Album');
    expect(container.querySelector('[value="enhanced"]').checked).toBe(true);
    expect(
      container
        .querySelector('[aria-label="Reset & reanalyse selected tracks"]')
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      container.querySelector('.ka-panel-footer button').textContent,
    ).toContain('Analyse 1 selected');
    expect(
      container
        .querySelector('.ka-folder-expand')
        .getAttribute('aria-expanded'),
    ).toBe('true');
    act(() => {
      ReactDOM.render(<div>Other view</div>, container);
    });
    await render({ viewState });
    expect(container.querySelector('.ka-search').value).toBe('Album');
    expect(
      container.querySelector('.ka-panel-footer button').textContent,
    ).toContain('Analyse 1 selected');
    expect(
      container
        .querySelector('.ka-folder-expand')
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });
  it('shows coverage without the removed automatic queue card', async () => {
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
    expect(queue).toBeNull();
    expect(container.textContent).not.toContain('Automatic preparation queue');
    expect(
      container.querySelector('[aria-label="Resume automatic preparation"]'),
    ).not.toBeNull();
    expect(container.querySelector('details.ka-analysis-help').open).toBe(
      false,
    );
  });

  it('separates successful, skipped and failed scan outcomes', async () => {
    expect.hasAssertions();
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      total: 100,
      analysed: 20,
      skipped: 3,
      failed: 1,
      inFlight: 8,
    });
    await render();
    const progress = container.querySelector(
      '[aria-label="Current scan progress"]',
    );
    expect(progress.textContent).toContain('Remaining: 68');
    expect(progress.textContent).toContain('Succeeded: 20');
    expect(progress.textContent).toContain('Skipped: 3');
    expect(progress.textContent).toContain('Failed: 1');
    expect(progress.textContent).toContain('Processed: 24 / 100');
    expect(container.textContent).toContain('Enhanced worker: Available');
  });
  it('shows coverage without waiting for automatic preparation status', async () => {
    expect.hasAssertions();
    let finish;
    getPreparationStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    expect(container.querySelector('.ka-summary-basic').textContent).toContain(
      '0Ready',
    );
    await act(async () => finish({ paused: true }));
  });

  it('explains unavailable initial coverage while continuing other status updates', async () => {
    expect.hasAssertions();
    musicLibraryApi.getAnalysisStats.mockRejectedValueOnce(
      new Error('timeout'),
    );
    await render();
    expect(container.textContent).toContain(
      'Library coverage is unavailable. Retrying automatically',
    );
    expect(container.querySelector('.ka-summary-basic').textContent).toContain(
      '—Ready',
    );
  });

  it('shows unknown coverage while loading and retains values with a stale warning on failure', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      let finish;
      musicLibraryApi.getAnalysisStats.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await render();
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('—Ready');
      await act(async () => finish({ total: 3, complete: 2 }));
      musicLibraryApi.getAnalysisStats.mockRejectedValueOnce(
        new Error('offline'),
      );
      analysisApi.getScanState.mockResolvedValue({ scanning: true });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('2Ready');
      expect(
        container.querySelector('[aria-label="Data freshness"]').textContent,
      ).toContain('Coverage: Stale');
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 3,
      });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('3Ready');
      expect(
        container.querySelector('[aria-label="Data freshness"]').textContent,
      ).not.toContain('Stale');
    } finally {
      jest.useRealTimers();
    }
  });
  it('updates automatic status even if scan polling fails and recovers on reconnect', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      await render();
      analysisApi.getScanState.mockRejectedValueOnce(new Error('offline'));
      getPreparationStatus.mockResolvedValue({
        paused: false,
        enhancedEnabled: false,
        counts: { queued: 9 },
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(container.textContent).toContain('Automatic preparation: Enabled');
      expect(container.textContent).toContain(
        'Enhanced worker: Not configured',
      );
      expect(
        container.querySelector('[aria-label="Pause after active tracks"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="Data freshness"]').textContent,
      ).toContain('Scan: Stale');
      analysisApi.getScanState.mockResolvedValue({ scanning: false });
      await act(async () => window.dispatchEvent(new Event('online')));
      expect(
        container.querySelector('[aria-label="Data freshness"]').textContent,
      ).not.toContain('Stale');
    } finally {
      jest.useRealTimers();
    }
  });
  it('refreshes visible rows and filtered folder totals during a scan without clearing selection', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      await render();
      await act(async () =>
        container.querySelector('.ka-folder-expand').click(),
      );
      await act(async () =>
        container.querySelector('.ka-folder-check input').click(),
      );
      const reads = musicLibraryApi.getTrackPage.mock.calls.length;
      analysisApi.getScanState.mockResolvedValue({ scanning: true, total: 3 });
      musicLibraryApi.getTrackPage.mockResolvedValue({
        items: [{ ...row('one'), bpm: 128 }, row('two'), row('three')],
        total: 3,
      });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(musicLibraryApi.getTrackPage.mock.calls.length).toBeGreaterThan(
        reads,
      );
      expect(container.querySelector('.ka-folder-check input').checked).toBe(
        true,
      );
      expect(container.textContent).toContain('128');
      await act(async () =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'Basic ready')
          .click(),
      );
      const token = usePagedList.mock.calls.at(-1)[2].refreshToken;
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(usePagedList.mock.calls.at(-1)[2].refreshToken).toBeGreaterThan(
        token,
      );
    } finally {
      jest.useRealTimers();
    }
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

  it('keeps manual workers separate from automatic queue totals', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { queued: 59_378, running: 0 },
    });
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      total: 100,
      analysed: 20,
      skipped: 0,
      failed: 0,
      inFlight: 8,
    });
    await render();
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
    expect(
      container.querySelector('.ka-progress-chip--active').textContent,
    ).toContain('Analysing: 8');
    expect(
      container.querySelector('.ka-progress-chip--queued').textContent,
    ).toContain('Remaining: 72');
  });
  it('does not add automatic reservations to the scan worker count', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { running: 8 },
    });
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      total: 100,
      inFlight: 8,
    });
    await render();
    expect(
      container.querySelector('.ka-progress-chip--active').textContent,
    ).toBe('Analysing: 8');
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { running: 16 },
    });
    await act(async () =>
      container.querySelector('.ka-toolbar [title="Refresh tracks"]').click(),
    );
    expect(
      container.querySelector('.ka-progress-chip--active').textContent,
    ).toBe('Analysing: 8');
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
  });
  it('updates scan workers independently and ignores stale in-flight counts after stopping', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      getPreparationStatus.mockResolvedValue({
        paused: true,
        counts: { running: 0 },
      });
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 100,
        inFlight: 8,
      });
      await render();
      expect(
        container.querySelector('.ka-progress-chip--active').textContent,
      ).toContain('Analysing: 8');
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 100,
        inFlight: 4,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-progress-chip--active').textContent,
      ).toContain('Analysing: 4');
      analysisApi.getScanState.mockResolvedValue({
        scanning: false,
        total: 100,
        inFlight: 8,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-progress-chip--active').textContent,
      ).toContain('Analysing: 0');
    } finally {
      jest.useRealTimers();
    }
  });
  it('uses active paths when older scan responses omit the worker count', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      paused: true,
      counts: { running: 0 },
    });
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      total: 3,
      analysed: 0,
      skipped: 0,
      failed: 0,
      inFlightPaths: ['one', 'two'],
    });
    await render();
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
    expect(
      container.querySelector('.ka-progress-chip--active').textContent,
    ).toContain('Analysing: 2');
  });
  it('refreshes Basic cards during a scan without library notifications or track-list reloads, then refreshes on completion', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({ scanning: true });
      await render();
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(1);
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 1,
        keyed: 1,
        bpmed: 1,
        waveformed: 1,
        loudness: 1,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('1Ready');
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(2);
      expect(musicLibraryApi.getTrackPage).not.toHaveBeenCalled();
      expect(usePagedList.mock.calls.at(-1)[2].refreshToken).toBe(0);
      analysisApi.getScanState.mockResolvedValue({
        scanning: false,
        completed: true,
      });
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 3,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('3Ready');
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
  it('refreshes coverage for automatic preparation even without a manual scan', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      getPreparationStatus.mockResolvedValue({
        paused: false,
        counts: { running: 2 },
      });
      await render();
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 2,
      });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('2Ready');
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(2);
      expect(analysisApi.startScan).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not repeatedly fetch headline counts for an idle queued library', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      getPreparationStatus.mockResolvedValue({
        paused: true,
        counts: { queued: 59_376, running: 0 },
      });
      await render();
      await act(async () => jest.advanceTimersByTime(12_000));
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('coalesces slow summary requests, library notifications and manual refreshes without delaying activity polling', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({ scanning: true });
      await render();
      let finish;
      musicLibraryApi.getAnalysisStats.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => jest.advanceTimersByTime(4_000));
      await act(async () => jest.advanceTimersByTime(4_000));
      useLibraryActivity.mockReturnValue({ libraryRevision: 1 });
      await render();
      await act(async () =>
        container.querySelector('.ka-toolbar [title="Refresh tracks"]').click(),
      );
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(2);
      expect(analysisApi.getScanState.mock.calls.length).toBeGreaterThan(2);
      await act(async () => finish({ total: 3, complete: 1 }));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('1Ready');
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 2,
      });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('2Ready');
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
  it('retains the last card values on a failed refresh and retries at the bounded interval', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({ scanning: true });
      musicLibraryApi.getAnalysisStats.mockResolvedValue({
        total: 3,
        complete: 1,
      });
      await render();
      musicLibraryApi.getAnalysisStats
        .mockRejectedValueOnce(new Error('temporarily busy'))
        .mockResolvedValue({ total: 3, complete: 2 });
      await act(async () => jest.advanceTimersByTime(4_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('1Ready');
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-summary-basic').textContent,
      ).toContain('2Ready');
      expect(musicLibraryApi.getAnalysisStats).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
  it('resumes automatic preparation explicitly without starting a manual library scan', async () => {
    expect.hasAssertions();
    await render();
    const resume = container.querySelector(
      '[aria-label="Resume automatic preparation"]',
    );
    expect(resume.disabled).toBe(false);
    expect(pausePreparation).not.toHaveBeenCalled();
    expect(resume.title).toContain('all automatic jobs');
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { queued: 3 },
    });
    await act(async () => resume.click());
    expect(pausePreparation).toHaveBeenCalledWith(false);
    expect(
      container.querySelector('[aria-label="Pause after active tracks"]'),
    ).not.toBeNull();
    expect(analysisApi.startScan).not.toHaveBeenCalled();
  });
  it('pauses after active tracks without cancelling them', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { running: 2 },
    });
    await render();
    getPreparationStatus.mockResolvedValue({
      paused: true,
      counts: { running: 2 },
    });
    await act(async () =>
      container
        .querySelector('[aria-label="Pause after active tracks"]')
        .click(),
    );
    expect(pausePreparation).toHaveBeenCalledWith(true);
    expect(analysisApi.cancelScan).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Resume automatic preparation"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
  });
  it('stops future scheduling when the current scan finishes during the request', async () => {
    expect.hasAssertions();
    analysisApi.getScanState.mockResolvedValue({ scanning: true });
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { running: 2 },
    });
    await render();
    analysisApi.getScanState.mockResolvedValue({ scanning: false });
    getPreparationStatus.mockResolvedValue({
      paused: true,
      counts: { queued: 3, running: 0 },
    });
    await act(async () =>
      container.querySelector('[aria-label="Stop analysis"]').click(),
    );
    expect(pausePreparation).toHaveBeenCalledWith(true);
    expect(analysisApi.cancelScan).not.toHaveBeenCalled();
    expect(analysisApi.startScan).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Stop analysis"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Resume automatic preparation"]'),
    ).not.toBeNull();
  });
  it('finishes every remaining track in the current scan before stopping', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 3,
        analysed: 1,
        inFlight: 2,
      });
      await render();
      const stop = container.querySelector(
        '.ka-scan-progress [aria-label="Stop analysis"]',
      );
      expect(stop.textContent).toBe('Stop after this scan');
      await act(async () => stop.click());
      expect(analysisApi.cancelScan).not.toHaveBeenCalled();
      expect(stop.disabled).toBe(true);
      expect(stop.textContent).toBe('Finishing scan…');
      expect(
        container.querySelector('[aria-label="Resume automatic preparation"]')
          .disabled,
      ).toBe(true);
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Finishing current scan…');
      await act(async () => stop.click());
      expect(analysisApi.cancelScan).not.toHaveBeenCalled();
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 3,
        analysed: 2,
        inFlight: 1,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(stop.textContent).toBe('Finishing scan…');
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Succeeded: 2');
      analysisApi.getScanState.mockResolvedValue({
        scanning: false,
        completed: true,
        total: 3,
        analysed: 3,
        inFlight: 0,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('[aria-label="Stop analysis"]'),
      ).toBeNull();
      expect(stop.isConnected).toBe(false);
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Finished');
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Succeeded: 3');
      expect(
        container.querySelector('[aria-label="Resume automatic preparation"]')
          .disabled,
      ).toBe(false);
      expect(analysisApi.startScan).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('keeps the stop request when scheduling is paused but refreshing status fails', async () => {
    expect.hasAssertions();
    jest.useFakeTimers();
    try {
      analysisApi.getScanState.mockResolvedValue({
        scanning: true,
        total: 3,
        inFlight: 2,
      });
      await render();
      getPreparationStatus.mockRejectedValueOnce(new Error('offline'));
      const stop = container.querySelector('[aria-label="Stop analysis"]');
      await act(async () => stop.click());
      expect(pausePreparation).toHaveBeenCalledWith(true);
      expect(analysisApi.cancelScan).not.toHaveBeenCalled();
      expect(stop.disabled).toBe(true);
      expect(stop.textContent).toBe('Finishing scan…');
      getPreparationStatus.mockResolvedValue({
        paused: true,
        counts: { running: 0 },
      });
      analysisApi.getScanState.mockResolvedValue({
        scanning: false,
        completed: true,
        total: 3,
        analysed: 3,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('[aria-label="Stop analysis"]'),
      ).toBeNull();
      expect(stop.isConnected).toBe(false);
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Finished');
    } finally {
      jest.useRealTimers();
    }
  });
  it('handles a scan that finishes just before Stop is pressed', async () => {
    expect.hasAssertions();
    analysisApi.getScanState.mockResolvedValue({
      scanning: true,
      total: 3,
      inFlight: 2,
    });
    await render();
    analysisApi.getScanState.mockResolvedValue({
      scanning: false,
      completed: true,
      total: 3,
      analysed: 3,
    });
    const stop = container.querySelector('[aria-label="Stop analysis"]');
    await act(async () => stop.click());
    expect(container.querySelector('[aria-label="Stop analysis"]')).toBeNull();
    expect(stop.isConnected).toBe(false);
    expect(
      container.querySelector('[aria-label="Current scan progress"]')
        .textContent,
    ).toContain('Finished');
    expect(
      container.querySelector('[aria-label="Resume automatic preparation"]')
        .disabled,
    ).toBe(false);
  });
  it('keeps controls usable after a pause failure and does not cancel while scheduling remains enabled', async () => {
    expect.hasAssertions();
    analysisApi.getScanState.mockResolvedValue({ scanning: true });
    getPreparationStatus.mockResolvedValue({
      paused: false,
      counts: { running: 2 },
    });
    await render();
    pausePreparation.mockRejectedValueOnce(new Error('offline'));
    await act(async () =>
      container.querySelector('[aria-label="Stop analysis"]').click(),
    );
    expect(analysisApi.cancelScan).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
    expect(
      container.querySelector('[aria-label="Pause after active tracks"]')
        .disabled,
    ).toBe(false);
  });
  it('shows select-all progress and allows cancellation without committing a partial selection', async () => {
    expect.hasAssertions();
    let finish;
    let signal;
    musicLibraryApi.getTrackPage
      .mockResolvedValueOnce({ items: [row('one'), row('two')], total: 3 })
      .mockImplementationOnce((query, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
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
    top = 900;
    await act(async () =>
      container.querySelector('.ka-col-check input').click(),
    );
    expect(
      container.querySelector('.ka-selection-status').textContent,
    ).toContain('Selecting tracks… 2 / 3');
    expect(container.querySelector('.ka-col-check input').disabled).toBe(true);
    expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(900);
    top = 550;
    act(() => container.querySelector('.ka-selection-status button').click());
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('.ka-col-check input').disabled).toBe(false);
    expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(550);
    await act(async () => finish({ items: [row('three')], total: 3 }));
    expect(container.querySelector('.ka-col-check input').checked).toBe(false);
    expect(container.querySelector('.ka-panel .ka-btn--primary').disabled).toBe(
      true,
    );
    expect(container.querySelector('.ka-selection-status')).toBeNull();
    expect(analysisApi.startScan).not.toHaveBeenCalled();
  });
  it('selects all matching tracks while automatic preparation is paused', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      container.querySelector('.ka-col-check input').click(),
    );
    expect(container.querySelector('.ka-col-check input').checked).toBe(true);
    expect(container.querySelector('.ka-folder-check input').checked).toBe(
      true,
    );
    expect(
      container.querySelector('.ka-panel .ka-btn--primary').textContent,
    ).toContain('Analyse 3 selected');
    expect(container.querySelector('.ka-panel .ka-btn--primary').disabled).toBe(
      false,
    );
    expect(pausePreparation).not.toHaveBeenCalled();
    expect(analysisApi.startScan).not.toHaveBeenCalled();
  });
  it('keeps automatic preparation controls without queue metrics while workers run', async () => {
    expect.hasAssertions();
    getPreparationStatus.mockResolvedValue({
      paused: false,
      enhancedEnabled: true,
      counts: { queued: 7, running: 2 },
    });
    await render();
    expect(
      container.querySelector('[aria-label="Preparation queue status"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Pause after active tracks"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Stop analysis"]').disabled,
    ).toBe(false);
  });
  it('shows manual progress separately and retains its final outcome', async () => {
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
        container.querySelector('[aria-label="Current scan progress"]'),
      ).not.toBeNull();
      analysisApi.getScanState.mockResolvedValue({
        scanning: false,
        completed: true,
        total: 3,
        analysed: 3,
        inFlight: 0,
      });
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(
        container.querySelector('.ka-progress-chip--active').textContent,
      ).toBe('Analysing: 0');
      expect(
        container.querySelector('[aria-label="Current scan progress"]')
          .textContent,
      ).toContain('Succeeded: 3');
    } finally {
      jest.useRealTimers();
    }
  });
  it('formats large coverage counts consistently without queue metrics', async () => {
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
    expect(
      container.querySelector('[aria-label="Preparation queue status"]'),
    ).toBeNull();
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
      'Select all matching tracks',
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
    expect(
      container.querySelector('.ka-panel input[value="basic"]').checked,
    ).toBe(true);
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
    expect(
      container.querySelector('.ka-panel input[value="enhanced"]').checked,
    ).toBe(true);
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
    expect(
      container.querySelector('.ka-panel input[value="basic"]').checked,
    ).toBe(true);
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
