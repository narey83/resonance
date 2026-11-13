import WaveformToolbar, {
  normalizeWaveformMarkerInterval,
} from './WaveformToolbar';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('Waveform toolbar', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  it('offers explicit zoom, size, grid, vocal and phrase controls', () => {
    expect.hasAssertions();
    const handlers = {
      onToggle: jest.fn(),
      onHeight: jest.fn(),
      onZoom: jest.fn(),
      onGrid: jest.fn(),
      onMarkerInterval: jest.fn(),
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
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Beat grid',
        ),
      );
    });
    act(() =>
      Simulate.click(container.querySelector('[aria-label="Waveform height"]')),
    );
    act(() =>
      Simulate.click(
        [
          ...document.querySelectorAll('.mp-dropdown-options [role="option"]'),
        ].find((item) => item.textContent === 'Studio'),
      ),
    );
    act(() =>
      Simulate.click(
        container.querySelector('[aria-label="Waveform phrase labels"]'),
      ),
    );
    act(() =>
      Simulate.click(
        [
          ...document.querySelectorAll('.mp-dropdown-options [role="option"]'),
        ].find((item) => item.textContent === 'Hide phrases'),
      ),
    );
    expect(handlers.onZoom).toHaveBeenCalledWith(16);
    expect(handlers.onHeight).toHaveBeenCalledWith(150);
    expect(handlers.onPhrases).toHaveBeenCalledWith('off');
    expect(handlers.onGrid).toHaveBeenCalledWith(false);
    expect(container.textContent).not.toContain('Compact');
  });
  it('selects Off, 16, 32 or 64 beats and normalizes saved values', () => {
    const onMarkerInterval = jest.fn();
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          enabled
          grid
          height={70}
          markerInterval={32}
          onMarkerInterval={onMarkerInterval}
          zoom={1}
        />,
        container,
      );
    });
    const trigger = container.querySelector(
      '[aria-label="Beat marker interval"]',
    );
    expect(trigger.textContent).toContain('32 beats');
    act(() => Simulate.click(trigger));
    expect(
      [
        ...document.querySelectorAll('.mp-dropdown-options [role="option"]'),
      ].map((option) => option.textContent),
    ).toEqual(['Markers off', '16 beats', '32 beats', '64 beats']);
    act(() =>
      Simulate.click(
        [
          ...document.querySelectorAll('.mp-dropdown-options [role="option"]'),
        ].find((option) => option.textContent === 'Markers off'),
      ),
    );
    expect(onMarkerInterval).toHaveBeenCalledWith(0);
    expect(normalizeWaveformMarkerInterval('64')).toBe(64);
    expect(normalizeWaveformMarkerInterval(0)).toBe(0);
    expect(normalizeWaveformMarkerInterval('invalid')).toBe(32);
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
    expect(phrases.textContent).toContain('Hide phrases');
    expect(onVocals).not.toHaveBeenCalled();
    expect(onPhrases).not.toHaveBeenCalled();

    render(true);
    expect(vocals.disabled).toBe(false);
    expect(vocals.getAttribute('aria-pressed')).toBe('true');
    expect(phrases.disabled).toBe(false);
    expect(phrases.textContent).toContain('Musical phrases');
  });
  it('explains Basic beat-only and missing-beat states without disabling the grid', () => {
    const render = (basicGridState, zoom = 1, grid = true) => {
      act(() => {
        ReactDOM.render(
          <WaveformToolbar
            basicGridState={basicGridState}
            enabled
            grid={grid}
            height={70}
            zoom={zoom}
          />,
          container,
        );
      });
    };

    render({ beatCount: 732, barPhaseStatus: 'unresolved' });
    expect(container.querySelector('[role="status"]').textContent).toBe(
      'Beat timing only · bar phase uncertain',
    );
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Beat grid',
      ).disabled,
    ).toBe(false);

    render({ beatCount: 732, barPhaseStatus: 'unresolved' }, 64);
    expect(container.querySelector('[role="status"]')).toBeNull();
    render({
      beatCount: 733,
      barPhaseStatus: 'unresolved',
      estimatedMarkerCount: 12,
    });
    expect(container.querySelector('[role="status"]').textContent).toBe(
      '32 beat count from first measured beat · estimated',
    );
    expect(container.querySelector('.mp-waveform-marker-key')).toBeNull();
    render(
      {
        beatCount: 733,
        barPhaseStatus: 'supported',
        estimatedMarkerCount: 12,
        estimatedFromBar: true,
      },
      64,
    );
    expect(container.querySelector('[role="status"]').textContent).toBe(
      '32 beat count from first measured beat · estimated',
    );
    render({ beatCount: 732, barPhaseStatus: 'supported' });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.mp-waveform-marker-key')).toBeNull();
    render({ beatCount: 732, barPhaseStatus: 'supported', markerCount: 12 });
    expect(container.querySelector('.mp-waveform-marker-key')).toBeNull();
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          basicGridState={{ beatCount: 732, markerCount: 12 }}
          enabled
          enhancedAvailable
          grid
          height={70}
          zoom={1}
        />,
        container,
      );
    });
    expect(container.querySelector('.mp-waveform-marker-key')).toBeNull();
    render({ beatCount: 0, barPhaseStatus: 'unresolved' });
    expect(container.querySelector('[role="status"]').textContent).toBe(
      'No detected beat timing yet',
    );
    render({ beatCount: 0, barPhaseStatus: 'unresolved' }, 64, false);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.mp-waveform-marker-key')).toBeNull();
  });
  it('supports keyboard navigation and Escape in the styled dropdown', () => {
    expect.hasAssertions();
    const onHeight = jest.fn();
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          enabled
          height={70}
          onHeight={onHeight}
          zoom={1}
        />,
        container,
      );
    });
    const height = container.querySelector('[aria-label="Waveform height"]');
    act(() => Simulate.keyDown(height, { key: 'ArrowDown' }));
    const options = document.querySelectorAll(
      '.mp-dropdown-options [role="option"]',
    );
    expect(options).toHaveLength(3);
    act(() => Simulate.keyDown(options[1], { key: 'End' }));
    expect(document.activeElement).toBe(options[2]);
    act(() => Simulate.keyDown(options[2], { key: 'Enter' }));
    expect(onHeight).toHaveBeenCalledWith(150);
    expect(height.getAttribute('aria-expanded')).toBe('false');
    act(() => Simulate.click(height));
    act(() =>
      Simulate.keyDown(
        document.querySelector('.mp-dropdown-options [role="option"]'),
        { key: 'Escape' },
      ),
    );
    expect(height.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(height);
  });
  it('keeps a previously saved 40px height available as a custom size', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <WaveformToolbar
          enabled
          height={40}
          zoom={1}
        />,
        container,
      );
    });
    const height = container.querySelector('[aria-label="Waveform height"]');
    expect(height.textContent).toContain('40px · Custom');
    act(() => Simulate.click(height));
    const options = [
      ...document.querySelectorAll('.mp-dropdown-options [role="option"]'),
    ];
    expect(options.map((option) => option.textContent)).toEqual([
      '40px · Custom',
      'Standard',
      'Large',
      'Studio',
    ]);
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
