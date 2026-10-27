import { getLogSummaries } from '../../../lib/logs';
import HourlySummary from './HourlySummary';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../../lib/logs', () => ({ getLogSummaries: jest.fn() }));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  BarChart: () => <div />,
  Bar: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe('hourly log summaries', () => {
  let container;
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
  });
  const mount = () =>
    act(() => {
      ReactDOM.render(<HourlySummary />, container);
    });
  const open = async () =>
    act(async () => container.querySelector('button').click());

  it('loads only when expanded and distinguishes archived counts from raw messages', async () => {
    expect.hasAssertions();
    getLogSummaries.mockResolvedValue([
      { hour: '2026-10-25T00:00:00', level: 'Error', count: 7 },
    ]);
    mount();
    expect(getLogSummaries).not.toHaveBeenCalled();
    await open();
    expect(
      container.querySelector('[role="img"]').getAttribute('aria-label'),
    ).toContain('7 archived entries');
    expect(container.textContent).toContain('Detailed messages have expired');
    expect(getLogSummaries).toHaveBeenCalledWith(30, expect.any(AbortSignal));
  });

  it('aborts stale history requests when the range changes', async () => {
    expect.hasAssertions();
    let resolveOld;
    getLogSummaries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    getLogSummaries.mockResolvedValue([]);
    mount();
    await open();
    const signal = getLogSummaries.mock.calls[0][1];
    await act(async () => {
      const select = container.querySelector('select');
      select.value = '7';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolveOld([{ hour: '2026-10-25T00:00:00', level: 'Error', count: 99 }]),
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).toContain(
      'No archived summaries in this period',
    );
  });

  it('shows an unavailable state without interrupting raw logs', async () => {
    expect.hasAssertions();
    getLogSummaries.mockRejectedValue(new Error('offline'));
    mount();
    await open();
    expect(container.textContent).toContain(
      'Hourly summaries are unavailable. Raw logs remain available.',
    );
  });
});
