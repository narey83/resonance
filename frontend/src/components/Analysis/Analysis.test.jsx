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
  getKeys: () => Promise.resolve([]),
  getTrackPage: jest.fn(),
}));
jest.mock('../../lib/useKeyFormat', () => ({
  useKeyFormat: () => ({ format: 'camelot', fmtKey: (key) => key }),
}));
jest.mock('../Shared/PageInfo', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Shared/KeyFormatToggle', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('./RowWaveform', () => ({ __esModule: true, default: () => null }));

const row = (path) => ({ path, directory: '/music/Album', filename: path });

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
      items: [row('one')],
      total: 3,
      loading: false,
      loadingMore: false,
      loadMore: jest.fn(),
      error: null,
    };
    usePagedList.mockImplementation(() => page);
    musicLibraryApi.getTrackPage.mockImplementation(async () => ({
      items: page.items,
      total: page.total,
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

  it('waits for initial loading and keeps results aligned when settings move them', async () => {
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
      page = { ...page, items: [row('one')], loading: false };
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
      act(() =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === 'Scan')
          .click(),
      );
      expect(useVirtualizer.mock.calls.at(-1)[0].scrollMargin).toBe(900);
      expect(
        container.querySelector('.ka-track-list [data-index="0"]').style
          .transform,
      ).toBe('translateY(0px)');
      top = 550;
      act(() => container.querySelector('.ka-panel .ka-btn').click());
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

  it('loads every page automatically and counts the complete folder', async () => {
    expect.hasAssertions();
    await render();
    expect(page.loadMore).toHaveBeenCalledTimes(1);
    page = { ...page, items: [row('one'), row('two')] };
    await render();
    expect(page.loadMore).toHaveBeenCalledTimes(2);
    page = { ...page, items: [...page.items, row('three')] };
    await render();
    expect(page.loadMore).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.ka-folder-badge').textContent).toBe(
      '3 tracks',
    );
    expect(container.textContent).toContain('Loaded 3 of 3 tracks');
  });

  it('stops on failure and offers a manual retry', async () => {
    expect.hasAssertions();
    page.error = new Error('network unavailable');
    await render();
    expect(page.loadMore).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => container.querySelector('.ka-page-btn').click());
    expect(page.loadMore).toHaveBeenCalledTimes(1);
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

  it('does not loop if a page returns no additional tracks', async () => {
    expect.hasAssertions();
    await render();
    page = { ...page, loadingMore: true };
    await render();
    page = { ...page, loadingMore: false };
    await render();
    expect(page.loadMore).toHaveBeenCalledTimes(1);
  });
  it('keeps a 5000-track folder bounded to visible rows and selects the whole folder', async () => {
    expect.hasAssertions();
    page = {
      ...page,
      items: Array.from({ length: 5_000 }, (_, index) => row(String(index))),
      total: 5_000,
    };
    await render();
    act(() => container.querySelector('.ka-folder-expand').click());
    expect(container.querySelectorAll('.ka-track')).toHaveLength(19);
    expect(container.querySelector('.ka-folder-badge').textContent).toBe(
      '5,000 tracks',
    );
    act(() => container.querySelector('.ka-folder-check input').click());
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
  it('uses one mode selector for the overview and scan settings', async () => {
    expect.hasAssertions();
    page = { ...page, items: [row('one'), row('two'), row('three')] };
    await render();
    const scanButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Scan',
    );
    act(() => scanButton.click());
    expect(container.querySelectorAll('[name="analysis-mode"]')).toHaveLength(
      2,
    );
    expect(container.querySelector('input[value="basic"]').checked).toBe(true);
    expect(container.querySelector('.ka-panel select')).toBeNull();
    expect(container.querySelector('.ka-panel').textContent).toContain(
      'Selected mode: Basic',
    );
    expect(
      container.querySelector('.ka-panel .ka-btn--primary').textContent,
    ).toContain('Start Basic Scan');
    await act(async () => {
      container.querySelector('.ka-panel .ka-btn--primary').click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhanced: false }),
    );

    act(() => scanButton.click());
    act(() => container.querySelector('input[value="enhanced"]').click());
    expect(container.querySelector('.ka-panel select')).toBeNull();
    expect(container.querySelector('.ka-panel').textContent).toContain(
      'Selected mode: Enhanced',
    );
    expect(
      container.querySelector('.ka-panel .ka-btn--primary').textContent,
    ).toContain('Start Enhanced Scan');
    await act(async () => {
      container.querySelector('.ka-panel .ka-btn--primary').click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhanced: true }),
    );
  });
  it('preserves scan options when changing the shared analysis mode', async () => {
    expect.hasAssertions();
    await render();
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Scan')
        .click(),
    );
    const skip = container.querySelector(
      '[role="switch"][aria-label="Skip already-analysed tracks"]',
    );
    const reset = container.querySelector(
      '[role="switch"][aria-label="Reset & re-scan all tracks"]',
    );
    expect(skip.getAttribute('aria-checked')).toBe('true');
    expect(reset.getAttribute('aria-checked')).toBe('false');
    act(() => reset.click());
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
    page = { ...page, items: [row('one'), row('two'), row('three')] };
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
    page = {
      ...page,
      total: 1,
      items: [
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
      ],
    };
    await render();
    expect(container.textContent).not.toContain('Result details:');
    act(() => container.querySelector('.ka-folder-expand').click());
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
