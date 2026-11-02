import { getLogs } from '../../lib/logs';
import AppContext from '../AppContext';
import AnalysisFailures from './AnalysisFailures';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/logs', () => ({ getLogs: jest.fn() }));

describe('failed tracks disclosure', () => {
  let container;
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    getLogs.mockResolvedValue({ logs: [], totalCount: 0 });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (isAdmin = true) =>
    act(async () => {
      ReactDOM.render(
        <AppContext.Provider value={{ isAdmin }}>
          <AnalysisFailures />
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
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
        to: `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`,
      }),
    );
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
});
