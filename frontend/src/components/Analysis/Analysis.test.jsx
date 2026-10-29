import * as analysisApi from '../../lib/analysis';
import * as musicLibraryApi from '../../lib/musicLibrary';
import { usePagedList } from '../../lib/usePagedList';
import Analysis from './Analysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 20) }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: index * 44,
      })),
    measureElement: () => {},
  }),
}));
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ play: jest.fn(), track: null }),
}));
jest.mock('../../lib/usePagedList', () => ({ usePagedList: jest.fn() }));
jest.mock('../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: 0 }),
}));
jest.mock('../../lib/analysis', () => ({
  METRICS: ['Key', 'Bpm'],
  startScan: jest.fn(),
  getScanState: () => Promise.resolve({ scanning: false }),
}));
jest.mock('../../lib/musicLibrary', () => ({
  getAnalysisStats: () => Promise.resolve({ total: 3, complete: 0 }),
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
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
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
  it('offers basic and enhanced scan modes with basic as the default', async () => {
    expect.hasAssertions();
    page = { ...page, items: [row('one'), row('two'), row('three')] };
    await render();
    const scanButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Scan',
    );
    act(() => scanButton.click());
    const mode = container.querySelector('.ka-panel select');
    expect(mode.value).toBe('basic');
    await act(async () => {
      container
        .querySelector('.ka-panel .ka-btn--primary')
        .click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhanced: false }),
    );

    act(() => scanButton.click());
    const enhancedMode = container.querySelector('.ka-panel select');
    act(() => {
      enhancedMode.value = 'enhanced';
      enhancedMode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('.ka-panel .ka-btn--primary')
        .click();
    });
    expect(analysisApi.startScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ enhanced: true }),
    );
  });
});
