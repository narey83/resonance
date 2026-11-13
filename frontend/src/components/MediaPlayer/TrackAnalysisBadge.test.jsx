import TrackAnalysisBadge from './TrackAnalysisBadge';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

describe('player track analysis badge', () => {
  const track = { localRelativePath: '/music/song.flac' };
  const basic = {
    hasWaveform: true,
    hasBeatGrid: true,
    bpm: 128,
    key: 'Am',
    lufs: -9,
  };
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
  });

  const render = (metadata, active = false, playedTrack = track) => {
    act(() => {
      ReactDOM.render(
        <TrackAnalysisBadge
          active={active}
          metadata={metadata}
          track={playedTrack}
        />,
        container,
      );
    });
    return container.querySelector('[role="status"]');
  };

  it('shows active analysis before the saved result and then Basic', () => {
    expect(render({}, true).getAttribute('aria-label')).toBe(
      'Track analysis: Analysing',
    );
    expect(render(basic).getAttribute('aria-label')).toBe(
      'Track analysis: Basic',
    );
  });

  it('shows Enhanced only when Basic and enhanced results are complete', () => {
    const enhanced = { ...basic, djSummary: '{"complete":true}' };
    expect(render(enhanced).getAttribute('aria-label')).toBe(
      'Track analysis: Enhanced',
    );
    expect(render({ ...enhanced, lufs: null }).getAttribute('aria-label')).toBe(
      'Track analysis: Pending',
    );
    expect(
      render({ ...enhanced, hasBeatGrid: false }).getAttribute('aria-label'),
    ).toBe('Track analysis: Pending');
  });

  it('does not claim local analysis for a remote preview', () => {
    expect(render(basic, false, { path: '/remote/song.flac' })).toBeNull();
  });
});
