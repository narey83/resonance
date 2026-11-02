import { usePlayer } from '../../../context/PlayerContext';
import { retryPreparation } from '../../../lib/libraryWorkspace';
import { usePagedList } from '../../../lib/usePagedList';
import AppContext from '../../AppContext';
import PreparationView from './BackgroundAnalysisQueue';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../../context/PlayerContext', () => ({ usePlayer: jest.fn() }));
jest.mock('../../../lib/usePagedList', () => ({ usePagedList: jest.fn() }));
jest.mock('../../../lib/libraryWorkspace', () => ({
  ...jest.requireActual('../../../lib/libraryWorkspace'),
  retryPreparation: jest.fn(),
}));
jest.mock('./AlbumArt', () => () => <span>Artwork</span>);
const click = async (container, text) =>
  act(async () =>
    Simulate.click(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent.includes(text),
      ),
    ),
  );

describe('Preparation workspace', () => {
  let container;
  let playQueue;
  const refresh = jest.fn();
  let status;
  beforeEach(() => {
    jest.clearAllMocks();
    playQueue = jest.fn();
    usePlayer.mockReturnValue({ playQueue });
    status = {
      total: 15,
      counts: { complete: 13, basic: 1, retrying: 1 },
      paused: false,
      enhancedEnabled: true,
      lastCheckedAt: 1,
      enrichment: { enabled: false },
    };
    usePagedList.mockReturnValue({
      items: [
        {
          state: 'complete',
          track: {
            path: '/track.mp3',
            title: 'Atlantis',
            artist: 'Artist',
            bpm: 138,
            key: 'Gm',
            duration: 403,
          },
        },
      ],
      total: 1,
      loading: false,
    });
    retryPreparation.mockResolvedValue({});
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async () =>
    act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <PreparationView
            onRefresh={refresh}
            status={status}
          />
        </MemoryRouter>,
        container,
      );
    });
  it('uses existing enrichment settings and groups the stages consistently', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).not.toContain('14 of 15 tracks analysed');
    expect(container.textContent).toContain('Background analysis queue');
    expect(container.textContent).toContain('Automatic enrichment is off');
    await click(container, 'Background waiting');
    expect(usePagedList.mock.calls.at(-1)[1].state).toBe('waiting');
  });
  it('queues playback with the current BPM and key intact', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      Simulate.click(container.querySelector('[aria-label="Play Atlantis"]')),
    );
    expect(playQueue).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          bpm: 138,
          key: 'Gm',
          localRelativePath: '/track.mp3',
          length: 403,
        }),
      ],
      0,
    );
  });

  it('shows background failures without describing the whole library as stopped', async () => {
    expect.hasAssertions();
    status = {
      total: 59_413,
      paused: true,
      counts: { complete: 36, queued: 59_377, failed: 1 },
      analysisError: 'Background worker unavailable',
    };
    await render();
    expect(container.textContent).toContain('Background scheduling off');
    expect(container.textContent).toContain('59377');
    expect(container.textContent).not.toContain('36 of 59413');
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      'Background worker unavailable',
    );
    expect(container.textContent).not.toContain('Resume preparation');
  });
  it('retains all stage filters, refresh and pagination', async () => {
    expect.hasAssertions();
    const loadMore = jest.fn();
    usePagedList.mockReturnValue({
      items: [],
      total: 100,
      loading: false,
      loadMore,
    });
    await render();
    const select = container.querySelector('select');
    expect([...select.options].map((option) => option.value)).toEqual([
      '',
      'analysed',
      'waiting',
      'complete',
      'basic',
      'queued',
      'running',
      'retrying',
      'failed',
    ]);
    await act(async () =>
      Simulate.change(select, { target: { value: 'failed' } }),
    );
    expect(usePagedList.mock.calls.at(-1)[1].state).toBe('failed');
    await click(container, 'Load more');
    expect(loadMore).toHaveBeenCalledWith();
    await act(async () =>
      Simulate.click(
        container.querySelector('[aria-label="Refresh background queue"]'),
      ),
    );
    expect(refresh).toHaveBeenCalledWith();
  });
  it('shows retry failures instead of reporting success', async () => {
    expect.hasAssertions();
    retryPreparation.mockRejectedValueOnce(new Error('offline'));
    usePagedList.mockReturnValue({
      items: [
        { state: 'failed', track: { path: '/failed.mp3', title: 'Failed' } },
      ],
      total: 1,
    });
    await render();
    await click(container, 'Retry analysis');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not reach the library',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
  it('preserves the enrichment settings link for administrators', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <AppContext.Provider value={{ isAdmin: true }}>
            <PreparationView
              onRefresh={refresh}
              status={status}
            />
          </AppContext.Provider>
        </MemoryRouter>,
        container,
      );
    });
    expect(container.querySelector('a').getAttribute('href')).toBe(
      '/system/options',
    );
  });
  it('shows unknown queue counts as unavailable instead of zero', async () => {
    expect.hasAssertions();
    status = null;
    await render();
    expect(
      [...container.querySelectorAll('.preparation-metrics strong')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['—', '—', '—']);
  });
  it('retries only the requested failed track', async () => {
    expect.hasAssertions();
    usePagedList.mockReturnValue({
      items: [
        {
          state: 'failed',
          detail: 'Analysis incomplete',
          track: { path: '/failed.mp3', title: 'Failed' },
        },
      ],
      total: 1,
      loading: false,
    });
    await render();
    await click(container, 'Retry analysis');
    expect(retryPreparation).toHaveBeenCalledWith('/failed.mp3');
  });
});
