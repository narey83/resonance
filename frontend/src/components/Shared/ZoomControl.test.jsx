import ZoomControl, { fitWorkspaceZoom } from './ZoomControl';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

const resize = (width, height) =>
  act(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: height,
      configurable: true,
    });
    window.dispatchEvent(new Event('resize'));
  });
describe('automatic interface size', () => {
  let container;
  let original;
  beforeEach(() => {
    localStorage.clear();
    original = { width: window.innerWidth, height: window.innerHeight };
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    Object.defineProperty(window, 'innerWidth', {
      value: original.width,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: original.height,
      configurable: true,
    });
    container.remove();
    localStorage.clear();
  });
  const render = () =>
    act(() => {
      ReactDOM.render(<ZoomControl />, container);
    });
  const button = (label) => container.querySelector(`[aria-label="${label}"]`);
  it('uses one bounded desktop scale for any page and never enlarges automatically', () => {
    expect.hasAssertions();
    expect(fitWorkspaceZoom(1_710, 903)).toBe(90);
    expect(fitWorkspaceZoom(1_280, 800)).toBe(80);
    expect(fitWorkspaceZoom(2_560, 1_440)).toBe(100);
    expect(fitWorkspaceZoom(700, 450)).toBe(67);
    expect(fitWorkspaceZoom(0, 0)).toBe(100);
  });
  it('fits by default and follows window resizes without changing manual preferences', () => {
    expect.hasAssertions();
    resize(1_710, 903);
    render();
    expect(button('Auto size').getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.style.zoom).toBe('0.9');
    resize(1_280, 800);
    expect(document.documentElement.style.zoom).toBe('0.8');
    expect(
      document.documentElement.style.getPropertyValue('--app-viewport-height'),
    ).toBe('1000px');
    expect(localStorage.getItem('resonance-ui-zoom')).toBeNull();
  });
  it('honours explicit zoom until Auto size is selected again, including automatic percentages between presets', () => {
    expect.hasAssertions();
    resize(1_600, 875);
    render();
    expect(
      button('Interface scale 87%. Use normal size (100%)'),
    ).not.toBeNull();
    act(() => Simulate.click(button('Auto size')));
    expect(localStorage.getItem('resonance-ui-zoom')).toBe('87');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    render();
    expect(
      button('Interface scale 87%. Use normal size (100%)'),
    ).not.toBeNull();
    act(() => Simulate.click(button('Increase interface scale')));
    resize(1_280, 800);
    expect(document.documentElement.style.zoom).toBe('0.9');
    expect(button('Auto size').getAttribute('aria-pressed')).toBe('false');
    act(() => Simulate.click(button('Auto size')));
    expect(document.documentElement.style.zoom).toBe('0.8');
    act(() =>
      Simulate.click(button('Interface scale 80%. Use normal size (100%)')),
    );
    expect(document.documentElement.style.zoom).toBe('1');
    expect(button('Auto size').getAttribute('aria-pressed')).toBe('false');
    expect(button('Increase interface scale').disabled).toBe(true);
  });
});
