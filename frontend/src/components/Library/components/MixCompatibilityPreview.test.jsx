import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { usePlayer } from '../../../context/PlayerContext';
import { getWaveform } from '../../../lib/analysis';
import api from '../../../lib/api';
import { resolveLibraryTracks } from '../../../lib/libraryWorkbench';
import { usePagedList } from '../../../lib/usePagedList';
import {
  MixCompatibilityPreview,
  MixPreviewButton,
  MixPreviewProvider,
  useMixTrack,
} from './MixCompatibilityPreview';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/PlayerContext', () => ({
  MAX_QUEUE: 500,
  usePlayer: jest.fn(),
}));
jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: jest.fn(),
}));
jest.mock('../../../lib/libraryWorkbench', () => ({
  ...jest.requireActual('../../../lib/libraryWorkbench'),
  resolveLibraryTracks: jest.fn(),
}));
jest.mock('../../../lib/analysis', () => ({ getWaveform: jest.fn() }));
jest.mock('../../../lib/prepareMixAudio', () => ({ renderMixDeck: jest.fn() }));
jest.mock('../../../lib/api', () => ({ get: jest.fn() }));
jest.mock('../../../lib/streamSignatures', () => ({
  seedSignatures: jest.fn(),
}));
jest.mock('../../../lib/usePagedList', () => ({
  usePagedList: jest.fn(),
}));
jest.mock('./PlaylistTools', () => ({ paths }) => (
  <span>Mixtape: {paths.join(' then ')}</span>
));

const a = {
  path: '/a',
  title: 'Outgoing track',
  artist: 'Artist A',
  bpm: 128,
  key: 'Am',
  duration: 240,
  lufs: -10,
  genre: 'House',
};
const b = {
  path: '/b',
  title: 'Incoming track',
  artist: 'Artist B',
  bpm: 130,
  key: 'C',
  duration: 240,
  lufs: -8,
  genre: 'House',
};
const defaultPair = { a, b };
const enhanced = {
  available: true,
  durationSeconds: 240,
  downbeats: Array.from({ length: 121 }, (_, i) => i * 2),
  beats: Array.from({ length: 481 }, (_, i) => i / 2),
  djPhrases: [],
  singing: [],
  processedVoice: [],
};
const button = (name) =>
  [...document.querySelectorAll('.mix-preview button')].find(
    (node) =>
      node.getAttribute('aria-label') === name ||
      node.textContent.trim() === name,
  );

describe('desktop mix preview workflow', () => {
  let container;
  let player;
  beforeEach(() => {
    jest.clearAllMocks();
    player = {
      track: a,
      queue: [
        { ...a, filename: a.path },
        { path: '/queued', filename: '/queued' },
      ],
      seekTrack: jest.fn(),
      pausePlayback: jest.fn(),
      configureAuditionTempo: jest.fn(() => true),
      addToQueueNext: jest.fn(),
      isPlaying: true,
    };
    usePlayer.mockReturnValue(player);
    usePagedList.mockReturnValue({ items: [a, b], total: 2, loading: false });
    useLibraryActivity.mockReturnValue({ libraryRevision: 0 });
    resolveLibraryTracks.mockImplementation(async ([path]) => [
      path === '/a' ? a : b,
    ]);
    api.get.mockResolvedValue({ data: enhanced });
    getWaveform.mockResolvedValue({
      analysisDuration: 240,
      overallPeaks: [0.2, 0.8, 0.4],
      downbeatConfidence: 0.8,
    });
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (
    pair = defaultPair,
    onPair = jest.fn(),
    onClose = jest.fn(),
    rehearsal = undefined,
  ) => {
    await act(async () => {
      ReactDOM.render(
        <MixCompatibilityPreview
          onClose={onClose}
          onPair={onPair}
          pair={pair}
          rehearsal={rehearsal}
        />,
        container,
      );
    });
    return { onPair, onClose };
  };

  it('compares saved metrics and uses cached-only waveforms without starting analysis', async () => {
    expect.hasAssertions();
    await render();
    expect(document.querySelector('.mix-preview').textContent).toContain(
      '-1.5%',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      '8A → 8B',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'None predicted',
    );
    expect(getWaveform).toHaveBeenCalledWith('/b', {
      bars: 512,
      cachedOnly: true,
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.mix-preview audio')).toHaveLength(0);
  });
  it('displays a genre mismatch without blocking an intentional handover', async () => {
    expect.hasAssertions();
    const incoming = { ...b, genre: 'Hip-Hop' };
    const tracks = new Map([
      ['/a', a],
      ['/b', incoming],
    ]);
    resolveLibraryTracks.mockImplementation(async ([path]) => [
      tracks.get(path),
    ]);
    await render({ a, b: incoming });
    const notice = document.querySelector(
      '.mix-preview .genre-warning.is-mismatch',
    );
    expect(notice.textContent).toContain('Genre mismatch');
    expect(notice.textContent).toContain('House');
    expect(notice.textContent).toContain('Hip-hop / R&B');
    expect(notice.textContent).toContain('matching BPM alone');
    expect(button('Audition B incoming').disabled).toBe(false);
  });
  it('shows conflicting predictions as uncertainty with both pieces of evidence', async () => {
    expect.hasAssertions();
    const incoming = { ...b, genre: 'Trance', djSummary: { genre: 'Hip-Hop' } };
    const tracks = new Map([
      ['/a', a],
      ['/b', incoming],
    ]);
    resolveLibraryTracks.mockImplementation(async ([path]) => [
      tracks.get(path),
    ]);
    await render({ a, b: incoming });
    const notice = document.querySelector(
      '.mix-preview .genre-warning.is-conflict',
    );
    expect(notice.textContent).toContain('Conflicting genre data');
    expect(notice.textContent).toContain('Tagged: Trance · Predicted: Hip-Hop');
    expect(document.querySelector('.genre-warning.is-mismatch')).toBeNull();
  });
  it('loads a Set Planner handover with its saved master, length and range', async () => {
    expect.hasAssertions();
    await render({
      ...defaultPair,
      settings: { masterBpm: 136, bars: 8, extendedTempo: true },
    });
    expect(
      document.querySelector('[aria-label="Master BPM source"]').value,
    ).toBe('custom');
    expect(document.querySelector('[aria-label="Master BPM"]').value).toBe(
      '136',
    );
    expect(
      document.querySelector('[aria-label="Suggested mix length"]').value,
    ).toBe('8');
    expect(document.querySelector('.mix-dual-player').textContent).toContain(
      '136 BPM master · 8-bar handover',
    );
  });
  it('locks the full-set master and keeps handover controls separate from normal playback', async () => {
    expect.hasAssertions();
    const onClose = jest.fn();
    const onSettingsChange = jest.fn();
    await render(
      { ...defaultPair, settings: { bars: 8, extendedTempo: true } },
      jest.fn(),
      onClose,
      {
        title: 'Fixed-tempo set',
        current: { master: 136, loading: false },
        onSettingsChange,
        navigation: <p>Handover 2 of 14</p>,
        footer: () => <p>Set rehearsal navigation</p>,
      },
    );
    const dialog = document.querySelector('.mix-preview');
    expect(dialog.classList.contains('is-set-rehearsal')).toBe(true);
    expect(dialog.textContent).toContain('Full-set rehearsal');
    expect(dialog.textContent).toContain('Handover 2 of 14');
    expect(dialog.textContent).toContain('136 BPM master · 8-bar handover');
    expect(
      document.querySelector('[aria-label="Master BPM source"]'),
    ).toBeNull();
    expect(button('Swap direction')).toBeUndefined();
    expect(button('Audition B incoming')).toBeUndefined();
    expect(player.seekTrack).not.toHaveBeenCalled();
    act(() => {
      Simulate.change(
        document.querySelector('[aria-label="Suggested mix length"]'),
        {
          target: { value: '16' },
        },
      );
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      bars: 16,
      extendedTempo: true,
    });
    expect(document.querySelector('.mix-dual-player').textContent).toContain(
      '136 BPM master · 16-bar handover',
    );
    act(() => Simulate.click(button('Change master in planner')));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('auditions the incoming window while retaining queue order and BPM/key', async () => {
    expect.hasAssertions();
    await render();
    act(() => Simulate.click(button('Audition B incoming')));
    const [queue, index, time] = player.seekTrack.mock.calls[0];
    expect(queue.map((row) => row.path)).toEqual(['/a', '/queued', '/b']);
    expect(index).toBe(2);
    expect(time).toBeGreaterThanOrEqual(0);
    expect(queue[2]).toEqual(
      expect.objectContaining({ bpm: 130, key: 'C', localRelativePath: '/b' }),
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'Existing queued tracks are kept',
    );
    act(() => Simulate.click(button('Pause')));
    expect(player.pausePlayback).toHaveBeenCalledTimes(1);
  });
  it('swaps direction explicitly and keeps mixtape paths in the comparison order', async () => {
    expect.hasAssertions();
    const { onPair } = await render();
    act(() => Simulate.click(button('Swap direction')));
    expect(onPair).toHaveBeenCalledWith({ a: b, b: a });
    expect(document.querySelector('.mix-preview-footer').textContent).toContain(
      '/a then /b',
    );
  });
  it('keeps a full queue intact instead of letting audition trim it', async () => {
    expect.hasAssertions();
    player.queue = Array.from({ length: 500 }, (_, i) => ({
      path: `/queued-${i}`,
    }));
    await render();
    act(() => Simulate.click(button('Audition B incoming')));
    expect(player.seekTrack).not.toHaveBeenCalled();
    expect(button('Queue full').disabled).toBe(true);
    expect(document.querySelector('.mix-preview-footer').textContent).toContain(
      'Your queue is full',
    );
  });
  it('supports 8/16/32-bar suggestions and queues B only on an explicit click', async () => {
    expect.hasAssertions();
    await render();
    expect(player.addToQueueNext).not.toHaveBeenCalled();
    act(() =>
      Simulate.change(
        document.querySelector('[aria-label="Suggested mix length"]'),
        { target: { value: '8' } },
      ),
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      '8 saved bars on each side',
    );
    act(() => Simulate.click(button('Queue B next')));
    expect(player.addToQueueNext).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/b', bpm: 130, key: 'C' }),
    );
  });
  it('offers the whole-library picker and prevents choosing the same track twice', async () => {
    expect.hasAssertions();
    const { onPair } = await render({ a, b: null });
    expect(
      document.querySelector('[aria-label="Search mix preview library"]'),
    ).not.toBeNull();
    expect(button('Choose Outgoing track for B').disabled).toBe(true);
    act(() => Simulate.click(button('Choose Incoming track for B')));
    expect(onPair).toHaveBeenCalledWith({ a, b });
  });
  it('keeps a partial comparison usable after a failed enhanced lookup', async () => {
    expect.hasAssertions();
    api.get.mockRejectedValue(new Error('offline'));
    await render();
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'Section and vocal analysis could not load',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      '-1.5%',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'Unknown',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'time-based suggestion',
    );
    expect(button('Retry analysis lookup')).toBeDefined();
  });
  it('handles deleted library tracks without audition or queue actions', async () => {
    expect.hasAssertions();
    resolveLibraryTracks.mockResolvedValue([]);
    await render();
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'no longer in the library',
    );
    expect(button('Audition B incoming')).toBeUndefined();
    expect(button('Queue B next')).toBeUndefined();
  });
  it('closes with Escape and restores focus', async () => {
    expect.hasAssertions();
    const previous = document.createElement('button');
    container.append(previous);
    previous.focus();
    const { onClose } = await render();
    expect(document.activeElement).toBe(button('Close mix preview'));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('pins A when opening, even when audition later changes the loaded player track', async () => {
    expect.hasAssertions();
    const Harness = () => {
      const [tick, setTick] = useState(0);
      return (
        <MixPreviewProvider>
          <MixPreviewButton />
          <button
            onClick={() => setTick((v) => v + 1)}
            type="button"
          >
            Update player
          </button>
          <span hidden>{tick}</span>
        </MixPreviewProvider>
      );
    };

    await act(async () => {
      ReactDOM.render(<Harness />, container);
    });
    await act(async () =>
      Simulate.click(container.querySelector('.mix-preview-launch')),
    );
    act(() => Simulate.click(button('Back to comparison')));
    player = { ...player, track: b };
    usePlayer.mockReturnValue(player);
    await act(async () =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (node) => node.textContent === 'Update player',
        ),
      ),
    );
    expect(document.querySelector('.mix-deck h3').textContent).toBe(
      'Outgoing track',
    );
  });
  it('ignores stale analysis responses when the chosen track changes', async () => {
    expect.hasAssertions();
    let resolveOld;
    const results = new Map([
      [
        '/a',
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      ],
      ['/b', Promise.resolve([b])],
    ]);
    resolveLibraryTracks.mockImplementation(([path]) => results.get(path));
    let latest;
    const Probe = ({ track }) => {
      latest = useMixTrack(track);
      return <span>{latest.track?.title}</span>;
    };

    await act(async () => {
      ReactDOM.render(<Probe track={a} />, container);
    });
    await act(async () => {
      ReactDOM.render(<Probe track={b} />, container);
    });
    expect(latest.track.path).toBe('/b');
    await act(async () => resolveOld([a]));
    expect(latest.track.path).toBe('/b');
  });
  it('defaults master BPM to the first track and updates it when the direction changes', async () => {
    expect.hasAssertions();
    await render();
    expect(document.querySelector('[aria-label="Master BPM"]').value).toBe(
      '128',
    );
    expect(document.querySelector('[aria-label="Master BPM"]').disabled).toBe(
      true,
    );
    await render({ a: b, b: a });
    expect(document.querySelector('[aria-label="Master BPM"]').value).toBe(
      '130',
    );
  });
  it('auditions B at the first track master with pitch-preserving speed and restores it on close', async () => {
    expect.hasAssertions();
    await render();
    act(() =>
      Simulate.change(
        [...document.querySelectorAll('.mix-master-check input')][0],
        { target: { checked: true } },
      ),
    );
    act(() => Simulate.click(button('Audition B incoming')));
    expect(player.configureAuditionTempo).toHaveBeenCalledWith({
      path: '/b',
      rate: 128 / 130,
    });
    expect(player.seekTrack).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(player.configureAuditionTempo).toHaveBeenLastCalledWith(null);
  });
  it('supports a custom master and shows both speed adjustments', async () => {
    expect.hasAssertions();
    await render();
    act(() =>
      Simulate.change(
        document.querySelector('[aria-label="Master BPM source"]'),
        { target: { value: 'custom' } },
      ),
    );
    act(() =>
      Simulate.change(document.querySelector('[aria-label="Master BPM"]'), {
        target: { value: '129' },
      }),
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'A +0.8%, B -0.8%',
    );
    act(() =>
      Simulate.change(
        [...document.querySelectorAll('.mix-master-check input')][0],
        { target: { checked: true } },
      ),
    );
    act(() => Simulate.click(button('Audition A outgoing')));
    expect(player.configureAuditionTempo).toHaveBeenCalledWith({
      path: '/a',
      rate: 129 / 128,
    });
  });
  it('rejects invalid custom BPM and provides a reviewed genre guide', async () => {
    expect.hasAssertions();
    await render();
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'Reviewed genre guide',
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'Same genre family',
    );
    act(() =>
      Simulate.change(
        document.querySelector('[aria-label="Master BPM source"]'),
        { target: { value: 'custom' } },
      ),
    );
    act(() =>
      Simulate.change(document.querySelector('[aria-label="Master BPM"]'), {
        target: { value: '0' },
      }),
    );
    expect(document.querySelector('.mix-preview').textContent).toContain(
      'between 20 and 400',
    );
    expect(button('Audition B incoming')).toBeUndefined();
  });
});
