import WaveformResizeHandle from './WaveformResizeHandle';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('waveform resizing', () => {
  it('supports keyboard resizing with bounded heights', () => {
    expect.hasAssertions();
    const container = document.createElement('div');
    const onHeight = jest.fn();
    act(() => {
      ReactDOM.render(
        <WaveformResizeHandle
          height={235}
          onHeight={onHeight}
        />,
        container,
      );
    });
    const handle = container.querySelector('[role="separator"]');
    act(() => {
      Simulate.keyDown(handle, { key: 'ArrowUp' });
      Simulate.keyDown(handle, { key: 'ArrowDown' });
    });
    expect(onHeight.mock.calls).toEqual([[240], [225]]);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
});
