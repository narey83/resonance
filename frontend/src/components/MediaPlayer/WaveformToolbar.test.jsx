import WaveformToolbar from './WaveformToolbar';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('Waveform toolbar', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
  it('offers explicit zoom, size, grid, vocal and phrase controls', () => {
    expect.hasAssertions();
    const handlers = {
      onToggle: jest.fn(),
      onHeight: jest.fn(),
      onZoom: jest.fn(),
      onGrid: jest.fn(),
      onVocals: jest.fn(),
      onPhrases: jest.fn(),
    };
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          {...handlers}
          enabled
          grid
          height={70}
          phrases="dj"
          vocals
          zoom={1}
        />,
        container,
      );
    });
    expect(
      container.querySelector('[aria-label="Zoom waveform out"]').disabled,
    ).toBe(true);
    act(() => {
      Simulate.click(
        container.querySelector('[aria-label="Zoom waveform in"]'),
      );
      Simulate.change(
        container.querySelector('[aria-label="Waveform height"]'),
        { target: { value: '150' } },
      );
      Simulate.change(
        container.querySelector('[aria-label="Waveform phrase labels"]'),
        { target: { value: 'off' } },
      );
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Beat grid',
        ),
      );
    });
    expect(handlers.onZoom).toHaveBeenCalledWith(16);
    expect(handlers.onHeight).toHaveBeenCalledWith(150);
    expect(handlers.onPhrases).toHaveBeenCalledWith('off');
    expect(handlers.onGrid).toHaveBeenCalledWith(false);
  });
  it('retains the waveform toggle when the waveform is hidden', () => {
    expect.hasAssertions();
    const onToggle = jest.fn();
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          enabled={false}
          onToggle={onToggle}
        />,
        container,
      );
    });
    expect(container.querySelectorAll('button')).toHaveLength(1);
    act(() => {
      Simulate.click(container.querySelector('button'));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
