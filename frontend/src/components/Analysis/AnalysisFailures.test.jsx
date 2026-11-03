import { resolveFailedTrackPaths } from '../../lib/analysisRetry';
import { getLogs } from '../../lib/logs';
import AppContext from '../AppContext';
import AnalysisFailures from './AnalysisFailures';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/analysisRetry', () => ({
  resolveFailedTrackPaths: jest.fn(),
}));
jest.mock('../../lib/logs', () => ({ getLogs: jest.fn() }));

const retryLogs = () => {
  getLogs.mockResolvedValue({
    logs: [
      {
        message: 'Analysis failed',
        context: 'Music / Analysis',
        properties: { File: '/music/one.mp3', Metrics: 'Loudness' },
        timestamp: '2026-11-02T12:00:00Z',
      },
      {
        message: 'Analysis failed',
        context: 'Music / Analysis',
        properties: { File: '/music/two.mp3', Metrics: 'Key' },
        timestamp: '2026-11-02T12:00:00Z',
      },
      {
        message: 'Analysis measurement failed',
        context: 'Music / Enhanced Analysis',
        properties: { Path: '/music/enhanced.mp3', Measurement: 'energy' },
        timestamp: '2026-11-02T12:00:00Z',
      },
    ],
    totalCount: 3,
  });
};

describe('failed tracks disclosure', () => {
  let container;
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    getLogs.mockResolvedValue({ logs: [], totalCount: 0 });
    resolveFailedTrackPaths.mockImplementation(async (rows) =>
      rows.map((row) => row.path),
    );
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (isAdmin = true, props = {}) =>
    act(async () => {
      ReactDOM.render(
        <AppContext.Provider value={{ isAdmin }}>
          <AnalysisFailures {...props} />
        </AppContext.Provider>,
        container,
      );
    });
  const expand = async () =>
    act(async () => {
      const details = container.querySelector('details');
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
  it('loads only when expanded and displays the failed measurement and reason', async () => {
    expect.hasAssertions();
    getLogs.mockResolvedValue({
      logs: [
        {
          context: 'Music / Enhanced Analysis',
          timestamp: '2026-11-02T12:00:00Z',
          message: 'Analysis measurement failed for song',
          properties: JSON.stringify({
            Path: '/music/song.mp3',
            Measurement: 'energy',
            Reason: 'Model missing',
          }),
        },
      ],
      totalCount: 101,
    });
    await render();
    expect(getLogs).not.toHaveBeenCalled();
    await expand();
    expect(getLogs).toHaveBeenCalledWith({
      offset: 0,
      limit: 100,
      level: ['Warning', 'Error'],
      context: ['Music / Analysis', 'Music / Enhanced Analysis'],
    });
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.textContent).toContain('song.mp3');
    expect(container.textContent).toContain('Energy:');
    expect(container.textContent).toContain('Model missing');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Older entries')
        .click(),
    );
    expect(getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 100, limit: 100 }),
    );
  });
  it('loads immediately as a dedicated Failures tab', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <AppContext.Provider value={{ isAdmin: true }}>
          <AnalysisFailures standalone />
        </AppContext.Provider>,
        container,
      );
    });
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(container.querySelector('section h2').textContent).toBe(
      'Failed tracks',
    );
  });
  it('preserves administrator-only log access', async () => {
    expect.hasAssertions();
    await render(false);
    expect(container.textContent).toBe('');
    expect(getLogs).not.toHaveBeenCalled();
  });
  it('retains loaded records and explains a refresh failure', async () => {
    expect.hasAssertions();
    getLogs.mockResolvedValue({
      logs: [
        {
          message: 'Analysis measurement failed',
          properties: {
            Path: '/music/retained.mp3',
            Measurement: 'bpm',
            Reason: 'No tempo',
          },
          timestamp: '2026-11-02T12:00:00Z',
        },
      ],
      totalCount: 1,
    });
    await render();
    await expand();
    getLogs.mockRejectedValueOnce(new Error('offline'));
    await act(async () => container.querySelector('button').click());
    expect(container.textContent).toContain('retained.mp3');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Previously loaded details are retained',
    );
  });
  it('retries one track or the shown failures of the same mode', async () => {
    expect.hasAssertions();
    retryLogs();
    const onRetry = jest.fn().mockResolvedValue(undefined);
    await render(true, { onRetry });
    await expand();
    await act(async () =>
      container
        .querySelector(
          '[aria-label="Retry Enhanced analysis for /music/enhanced.mp3"]',
        )
        .click(),
    );
    expect(onRetry).toHaveBeenLastCalledWith({
      paths: ['/music/enhanced.mp3'],
      enhanced: true,
    });
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find(
          (button) => button.textContent === 'Retry Basic failures shown (2)',
        )
        .click(),
    );
    expect(onRetry).toHaveBeenLastCalledWith({
      paths: ['/music/one.mp3', '/music/two.mp3'],
      enhanced: false,
    });
    expect(container.textContent).toContain(
      'Retry scan requested for 2 tracks',
    );
  });
  it('disables retry during an active scan and does not resolve any files', async () => {
    expect.hasAssertions();
    retryLogs();
    const onRetry = jest.fn();
    await render(true, {
      onRetry,
      retryDisabled: true,
      retryReason: 'Wait for the current scan.',
    });
    await expand();
    const button = container.querySelector(
      '[aria-label="Retry Basic analysis for /music/one.mp3"]',
    );
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(resolveFailedTrackPaths).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
  it('prevents duplicate submissions and reports conflicts without claiming success', async () => {
    expect.hasAssertions();
    retryLogs();
    const onRetry = jest
      .fn()
      .mockRejectedValue({ response: { data: 'A scan is already running.' } });
    let finish;
    resolveFailedTrackPaths.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, { onRetry });
    await expand();
    const button = container.querySelector(
      '[aria-label="Retry Basic analysis for /music/one.mp3"]',
    );
    act(() => {
      button.click();
      button.click();
    });
    expect(resolveFailedTrackPaths).toHaveBeenCalledTimes(1);
    await act(async () => finish(['/music/one.mp3']));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'already running',
    );
    expect(container.textContent).not.toContain('Retry scan requested');
  });
  it('does not start analysis when a historic filename cannot be resolved safely', async () => {
    expect.hasAssertions();
    retryLogs();
    const onRetry = jest.fn();
    resolveFailedTrackPaths.mockRejectedValueOnce(
      new Error('Several library tracks match this name.'),
    );
    await render(true, { onRetry });
    await expand();
    await act(async () =>
      container
        .querySelector('[aria-label="Retry Basic analysis for /music/one.mp3"]')
        .click(),
    );
    expect(onRetry).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Several library tracks',
    );
  });
  it('explains and disables Enhanced retry when its worker is unavailable', async () => {
    expect.hasAssertions();
    retryLogs();
    await render(true, { onRetry: jest.fn(), enhancedAvailable: false });
    await expand();
    expect(
      container.querySelector(
        '[aria-label="Retry Enhanced analysis for /music/enhanced.mp3"]',
      ).disabled,
    ).toBe(true);
    expect(container.textContent).toContain(
      'Enhanced retries require an available Enhanced worker',
    );
  });
  it('cancels unresolved retry work when leaving the failure view', async () => {
    expect.hasAssertions();
    retryLogs();
    const onRetry = jest.fn();
    let finish;
    resolveFailedTrackPaths.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, { onRetry });
    await expand();
    act(() =>
      container
        .querySelector('[aria-label="Retry Basic analysis for /music/one.mp3"]')
        .click(),
    );
    const { signal } = resolveFailedTrackPaths.mock.calls[0][1];
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(['/music/one.mp3']));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps full paths and original messages inside collapsed row details', async () => {
    expect.hasAssertions();
    retryLogs();
    await render();
    await expand();
    const row = container.querySelector('.ka-failure-list > li');
    const details = row.querySelector('details');
    expect(details.open).toBe(false);
    expect(details.querySelector('.ka-failure-path').textContent).toBe(
      '/music/one.mp3',
    );
    expect(row.querySelector('.ka-failure-row .ka-failure-path')).toBeNull();
    expect(row.querySelector('.ka-failure-measurements').textContent).toContain(
      'Loudness:',
    );
    expect(details.textContent).toContain('Original log entries');
  });
  it('keeps loading inside the existing refresh control and retains the empty result message', async () => {
    expect.hasAssertions();
    await render(true, { standalone: true });
    expect(container.textContent).toContain('No failed tracks in this page');
    let finish;
    getLogs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => container.querySelector('.ka-failure-refresh').click());
    const button = container.querySelector('.ka-failure-refresh');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[role="status"]').textContent).toBe(
      'Loading…',
    );
    expect(button.querySelector('span').style.visibility).toBe('hidden');
    expect(container.querySelector('p[role="status"]')).toBeNull();
    expect(container.textContent).toContain('No failed tracks in this page');
    await act(async () => finish({ logs: [], totalCount: 0 }));
    expect(button.getAttribute('aria-busy')).toBe('false');
  });
});
