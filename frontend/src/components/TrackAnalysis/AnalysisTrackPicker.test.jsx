import { getTracks } from '../../lib/musicLibrary';
import AnalysisTrackPicker from './AnalysisTrackPicker';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/musicLibrary', () => ({ getTracks: jest.fn() }));

describe('whole-library waveform search', () => {
  let container;
  const onSelect = jest.fn();
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<AnalysisTrackPicker onSelect={onSelect} />, container);
    });
  };

  const search = async (value) => {
    act(() =>
      Simulate.change(container.querySelector('input'), { target: { value } }),
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    getTracks.mockResolvedValue({ tracks: [] });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  it('queries the complete library in a bounded window and supports keyboard selection', async () => {
    expect.hasAssertions();
    const track = {
      path: '/music/beyond-first-5000.mp3',
      title: 'Outside the old window',
      artist: 'Artist',
    };
    getTracks.mockResolvedValue({ tracks: [track], total: 1 });
    await render();
    expect(getTracks).not.toHaveBeenCalled();
    await search('Outside');
    expect(getTracks).toHaveBeenCalledWith(
      { search: 'Outside', limit: 8, sort: 'title' },
      { signal: expect.any(AbortSignal) },
    );
    expect(container.textContent).toContain(track.title);
    act(() =>
      Simulate.keyDown(container.querySelector('input'), { key: 'ArrowUp' }),
    );
    expect(
      container.querySelector('[role="option"]').getAttribute('aria-selected'),
    ).toBe('true');
    act(() =>
      Simulate.keyDown(container.querySelector('input'), { key: 'Enter' }),
    );
    expect(onSelect).toHaveBeenCalledWith(track);
    expect(
      container
        .querySelector('[role="combobox"]')
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });
  it('cancels obsolete searches and ignores late responses', async () => {
    expect.hasAssertions();
    let resolveOld;
    getTracks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue({ tracks: [{ path: 'new', title: 'New result' }] });
    await render();
    await search('Old');
    const signal = getTracks.mock.calls[0][1].signal;
    expect(container.textContent).toContain('Searching the music library');
    await search('New');
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolveOld({ tracks: [{ path: 'old', title: 'Stale result' }] }),
    );
    expect(container.textContent).toContain('New result');
    expect(container.textContent).not.toContain('Stale result');
  });
  it('explains empty and failed searches and retries', async () => {
    expect.hasAssertions();
    await render();
    await search('Missing');
    expect(container.textContent).toContain('No tracks match');
    getTracks.mockRejectedValueOnce(new Error('offline'));
    await search('Retry');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not search',
    );
    getTracks.mockResolvedValue({
      tracks: [{ path: 'found', title: 'Recovered' }],
    });
    await act(async () =>
      Simulate.click(container.querySelector('[role="alert"] button')),
    );
    expect(container.textContent).toContain('Recovered');
  });
});
