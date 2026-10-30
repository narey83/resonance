import { usePlayer } from '../../../context/PlayerContext';
import usePreparationStatus from '../../../hooks/usePreparationStatus';
import {
  pausePreparation,
  retryPreparation,
} from '../../../lib/libraryWorkspace';
import { usePagedList } from '../../../lib/usePagedList';
import PreparationView, { PreparationHomeCard } from './PreparationView';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../../context/PlayerContext', () => ({ usePlayer: jest.fn() }));
jest.mock('../../../hooks/usePreparationStatus', () => jest.fn());
jest.mock('../../../lib/usePagedList', () => ({ usePagedList: jest.fn() }));
jest.mock('../../../lib/libraryWorkspace', () => ({
  ...jest.requireActual('../../../lib/libraryWorkspace'),
  pausePreparation: jest.fn(),
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
  beforeEach(() => {
    jest.clearAllMocks();
    playQueue = jest.fn();
    usePlayer.mockReturnValue({ playQueue });
    usePreparationStatus.mockReturnValue({
      status: {
        total: 15,
        counts: { complete: 13, basic: 1, retrying: 1 },
        paused: false,
        enhancedEnabled: true,
        lastCheckedAt: 1,
        enrichment: { enabled: false },
      },
      refresh,
    });
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
    pausePreparation.mockResolvedValue({});
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
          <PreparationView />
        </MemoryRouter>,
        container,
      );
    });
  it('uses existing enrichment settings and groups the stages consistently', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).toContain('14 of 15 tracks analysed');
    expect(container.textContent).toContain('Automatic enrichment is off');
    await click(container, 'Analysed');
    expect(usePagedList.mock.calls.at(-1)[1].state).toBe('analysed');
    await click(container, 'Waiting');
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

  it('shows the missing-package stop reason on Home and in Preparation', async () => {
    expect.hasAssertions();
    const analysisError =
      'Basic analysis stopped: required Essentia packages are missing.';
    usePreparationStatus.mockReturnValue({
      status: { total: 1, paused: true, counts: { failed: 1 }, analysisError },
      refresh,
    });
    await render();
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      analysisError,
    );
    act(() => {
      ReactDOM.render(<PreparationHomeCard />, container);
    });
    expect(container.textContent).toContain('Analysis stopped');
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      analysisError,
    );
  });
  it('shows an analysed library as up to date during playback', async () => {
    expect.hasAssertions();
    usePreparationStatus.mockReturnValue({
      status: {
        total: 15,
        counts: { complete: 15 },
        enhancedEnabled: true,
        lastCheckedAt: 1,
        waitingReason: 'Waiting for playback to go idle',
        enrichment: { enabled: true },
      },
      refresh,
    });
    await render();
    expect(container.textContent).toContain('Up to date');
    expect(container.textContent).not.toContain(
      'Waiting for playback to go idle',
    );
  });
  it('pauses automatic preparation without changing enrichment', async () => {
    expect.hasAssertions();
    await render();
    await click(container, 'Pause after current track');
    expect(pausePreparation).toHaveBeenCalledWith(true);
    expect(refresh).toHaveBeenCalledWith();
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
