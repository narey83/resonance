import TrackAnalysis from './TrackAnalysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../Analysis/Analysis', () => () => (
  <p>Unified analysis workspace</p>
));
jest.mock('./WaveformAnalysis', () => () => <p>Waveform inspection</p>);

describe('single analysis page', () => {
  it('keeps one analysis workspace and a waveform inspector', () => {
    expect.hasAssertions();
    const container = document.createElement('div');
    document.body.append(container);
    act(() => {
      ReactDOM.render(<TrackAnalysis />, container);
    });
    expect(container.textContent).not.toContain('Advanced analysis');
    expect(container.querySelectorAll('.ta-tab')).toHaveLength(2);
    expect(container.textContent).toContain('Unified analysis workspace');
    act(() => container.querySelectorAll('.ta-tab')[1].click());
    expect(container.textContent).toContain('Waveform inspection');
    act(() => container.querySelectorAll('.ta-tab')[0].click());
    expect(container.textContent).toContain('Unified analysis workspace');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
});
