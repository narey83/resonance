import StartupStatus from './StartupStatus';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('Startup status', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });
  const services = [
    { id: 'db', name: 'Database', state: 'ready' },
    {
      id: 'core',
      name: 'Core services',
      state: 'starting',
      message: 'Recovering transfers',
    },
  ];
  it('shows progress and only unfinished services', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus status={{ ready: false, services }} />,
        container,
      );
    });
    expect(container.textContent).toContain('1 of 2 services ready');
    expect(container.textContent).toContain('Core services: starting');
    expect(container.textContent).not.toContain('Database:');
  });
  it('disappears after successful startup', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus
          status={{
            ready: true,
            services: services.map((s) => ({ ...s, state: 'ready' })),
          }}
        />,
        container,
      );
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('keeps failures visible and allows dismissal', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus
          status={{
            ready: true,
            services: [
              {
                id: 'core',
                name: 'Core services',
                state: 'failed',
                message: 'Connection failed',
              },
            ],
          }}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Connection failed');
    act(() =>
      Simulate.click(container.querySelector('[aria-label="Dismiss"]')),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('moves by pointer and keeps the panel on screen', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus status={{ ready: false, services }} />,
        container,
      );
    });
    const panel = container.querySelector('[role="status"]');
    panel.getBoundingClientRect = () => ({
      left: 100,
      top: 56,
      width: 300,
      height: 100,
    });
    Object.defineProperty(panel, 'offsetWidth', { value: 300 });
    const handle = container.querySelector('[aria-label="Move startup panel"]');
    act(() => {
      Simulate.pointerDown(handle, {
        button: 0,
        pointerId: 1,
        clientX: 110,
        clientY: 60,
      });
    });
    act(() => {
      Simulate.pointerMove(handle, {
        pointerId: 1,
        clientX: 310,
        clientY: 260,
      });
    });
    expect(panel.style.left).toBe('300px');
    expect(panel.style.top).toBe('256px');
    act(() => {
      Simulate.pointerMove(handle, {
        pointerId: 1,
        clientX: -1_000,
        clientY: -1_000,
      });
    });
    expect(panel.style.left).toBe('8px');
    expect(panel.style.top).toBe('8px');
    act(() => {
      Simulate.pointerUp(handle);
    });
    act(() => {
      Simulate.pointerMove(handle, {
        pointerId: 1,
        clientX: 500,
        clientY: 500,
      });
    });
    expect(panel.style.left).toBe('8px');
  });
  it('supports keyboard movement and reset at interface zoom', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus status={{ ready: false, services }} />,
        container,
      );
    });
    const panel = container.querySelector('[role="status"]');
    panel.getBoundingClientRect = () => ({
      left: 100,
      top: 56,
      width: 300,
      height: 100,
    });
    Object.defineProperty(panel, 'offsetWidth', { value: 600 });
    const handle = container.querySelector('[aria-label="Move startup panel"]');
    act(() => {
      Simulate.keyDown(handle, { key: 'ArrowRight' });
    });
    expect(panel.style.left).toBe('220px');
    act(() => {
      Simulate.keyDown(handle, { key: 'Home' });
    });
    expect(panel.style.left).toBe('');
    expect(panel.style.transform).toBe('');
  });
  it('brings a moved panel back within a resized window', () => {
    act(() => {
      ReactDOM.render(
        <StartupStatus status={{ ready: false, services }} />,
        container,
      );
    });
    const panel = container.querySelector('[role="status"]');
    panel.getBoundingClientRect = () => ({
      left: 900,
      top: 700,
      width: 300,
      height: 100,
    });
    Object.defineProperty(panel, 'offsetWidth', { value: 300 });
    const handle = container.querySelector('[aria-label="Move startup panel"]');
    act(() => {
      Simulate.keyDown(handle, { key: 'ArrowRight' });
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(
      window.innerWidth - 308,
    );
    expect(Number.parseFloat(panel.style.top)).toBeLessThanOrEqual(
      window.innerHeight - 108,
    );
  });
});
