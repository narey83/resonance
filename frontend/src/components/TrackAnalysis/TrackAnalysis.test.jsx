import TrackAnalysis from './TrackAnalysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../Analysis/Analysis', () => ({ activeView }) => (
  <p>Analysis view: {activeView}</p>
));
jest.mock('./WaveformAnalysis', () => () => <p>Waveform inspection</p>);

describe('analysis workspace tabs', () => {
  it('defaults to Overview and remembers tabs with keyboard navigation', () => {
    expect.hasAssertions();
    localStorage.clear();
    const container = document.createElement('div');
    document.body.append(container);
    act(() => {
      ReactDOM.render(<TrackAnalysis />, container);
    });
    expect(container.textContent).not.toContain('Advanced analysis');
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]').textContent,
    ).toContain('Overview');
    expect(container.textContent).toContain('Analysis view: overview');
    act(() => container.querySelectorAll('.ta-tab')[3].click());
    expect(container.textContent).toContain('Waveform inspection');
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
