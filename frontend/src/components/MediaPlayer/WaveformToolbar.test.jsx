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
          enhancedAvailable
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
  it('greys out enhanced controls for Basic tracks and restores saved choices', () => {
    expect.hasAssertions();
    const onVocals = jest.fn();
    const onPhrases = jest.fn();
    const render = (enhancedAvailable) => {
      act(() => {
        ReactDOM.render(
          <WaveformToolbar
            enabled
            enhancedAvailable={enhancedAvailable}
            grid
            height={70}
            onPhrases={onPhrases}
            onVocals={onVocals}
            phrases="musical"
            vocals
            zoom={1}
          />,
          container,
        );
      });
    };

    render(false);
    const vocals = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Vocals',
    );
    const phrases = container.querySelector(
      '[aria-label="Waveform phrase labels"]',
    );
    expect(vocals.disabled).toBe(true);
    expect(vocals.getAttribute('aria-pressed')).toBe('false');
    expect(phrases.disabled).toBe(true);
    expect(phrases.value).toBe('off');
    expect(onVocals).not.toHaveBeenCalled();
    expect(onPhrases).not.toHaveBeenCalled();

    render(true);
    expect(vocals.disabled).toBe(false);
    expect(vocals.getAttribute('aria-pressed')).toBe('true');
    expect(phrases.disabled).toBe(false);
    expect(phrases.value).toBe('musical');
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
