import api from '../../lib/api';
import WaveformAnalysis from './WaveformAnalysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ track: null }),
}));
jest.mock('../../lib/files', () => ({
  getLocalStreamUrl: () => '/test-audio',
}));
jest.mock('./AnalysisTrackPicker', () => ({ onSelect }) => (
  <button
    onClick={() => onSelect({ path: '/music/test.mp3', title: 'Test track' })}
    type="button"
  >
    Choose test track
  </button>
));
jest.mock('./ImportedAnalysisPanel', () => () => (
  <p>Imported analysis options</p>
));
jest.mock('./CandidateAnalysisPanel', () => () => (
  <p>Independent analysis options</p>
));
jest.mock('wavesurfer.js', () => ({
  create: () => ({
    destroy: jest.fn(),
    getDuration: () => 120,
    load: () => Promise.resolve(),
    on: (event, callback) => {
      if (event === 'ready') return callback();
      return undefined;
    },
    zoom: jest.fn(),
  }),
}));

describe('waveform inspection hierarchy', () => {
  it('shows the waveform before optional analysis forms and restores the chosen track', async () => {
    expect.hasAssertions();
    const container = document.createElement('div');
    document.body.append(container);
    const viewState = { current: null };
    await act(async () => {
      ReactDOM.render(<WaveformAnalysis viewState={viewState} />, container);
    });
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(container.querySelector('.wa-duration-badge').textContent).toBe(
      '2:00',
    );
    expect(container.querySelector('.wa-analysis-options').open).toBe(false);
    expect(container.textContent).not.toContain('Imported analysis options');
    const details = container.querySelector('.wa-analysis-options');
    details.open = true;
    await act(async () => Simulate.toggle(details));
    expect(container.textContent).toContain('Imported analysis options');
    expect(container.textContent).toContain('Independent analysis options');
    expect(
      container.querySelector('.wa-display').compareDocumentPosition(details),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    act(() => {
      ReactDOM.render(<div>Other view</div>, container);
    });
    await act(async () => {
      ReactDOM.render(<WaveformAnalysis viewState={viewState} />, container);
    });
    expect(container.querySelector('.wa-duration-badge').textContent).toBe(
      '2:00',
    );
    expect(viewState.current.selectedTrack.path).toBe('/music/test.mp3');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  it('reads cached frequency data without starting a new scan', async () => {
    expect.hasAssertions();
    const context = { clearRect: jest.fn(), fillRect: jest.fn() };
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    api.get.mockResolvedValue({
      data: {
        overallPeaks: [0.5],
        lowPeaks: [0.2],
        midPeaks: [0.2],
        highPeaks: [0.1],
        analysisDuration: 120,
      },
    });
    api.post.mockClear();
    const container = document.createElement('div');
    document.body.append(container);
    try {
      await act(async () => {
        ReactDOM.render(
          <WaveformAnalysis
            viewState={{
              current: {
                selectedTrack: { path: '/music/cached.mp3', bpm: 120 },
              },
            }}
          />,
          container,
        );
      });
      const bars = [...container.querySelectorAll('.wa-mode-btn')].find(
        (button) => button.textContent === 'Bars',
      );
      await act(async () => {
        Simulate.click(bars);
      });
      expect(api.get).toHaveBeenCalledWith('/analysis/waveform', {
        params: { cachedOnly: true, path: '/music/cached.mp3' },
        signal: expect.any(AbortSignal),
      });
      expect(api.post).not.toHaveBeenCalled();
      expect(container.querySelector('.wa-error')).toBeNull();
      expect(container.querySelector('.wa-duration-badge').textContent).toBe(
        '2:00',
      );
    } finally {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      container.remove();
      getContext.mockRestore();
    }
  });
});
