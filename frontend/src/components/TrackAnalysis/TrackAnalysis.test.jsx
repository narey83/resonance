import TrackAnalysis from './TrackAnalysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../Analysis/Analysis', () => ({ activeView, onScanState }) => {
  jest.requireActual('react').useEffect(() => {
    onScanState?.({ failed: 3 });
  }, [onScanState]);
  return <p>Analysis view: {activeView}</p>;
});

describe('analysis workspace tabs', () => {
  it('falls back from the removed inspector to Overview and keeps three keyboard-accessible tabs', () => {
    expect.hasAssertions();
    localStorage.clear();
    localStorage.setItem('resonance-analysis-tab', 'waveform');
    const container = document.createElement('div');
    document.body.append(container);
    act(() => {
      ReactDOM.render(<TrackAnalysis />, container);
    });
    expect(container.textContent).not.toContain('Advanced analysis');
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]').textContent,
    ).toContain('Overview');
    expect(container.textContent).toContain('Analysis view: overview');
    expect(
      container.querySelector('#track-analysis-tab-failures').textContent,
    ).toBe('Failures');
    expect(container.textContent).not.toContain('Waveform Inspector');
    act(() => container.querySelectorAll('.ta-tab')[1].click());
    expect(container.textContent).toContain('Analysis view: analysis');
    expect(localStorage.getItem('resonance-analysis-tab')).toBe('analysis');
    act(() => {
      container
        .querySelectorAll('.ta-tab')[1]
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
    });
    expect(
      container.querySelector('[aria-selected="true"]').textContent,
    ).toContain('Failures');
    expect(document.activeElement.id).toBe('track-analysis-tab-failures');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
});
