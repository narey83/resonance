import * as reports from '../../lib/reports';
import { emitTransferComplete } from '../../lib/transferEvents';
import TransferHistory from './TransferHistory';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/reports', () => ({
  getTransferHistory: jest.fn(),
  getTransferAttempts: jest.fn(),
}));
/* eslint-disable unicorn/consistent-function-scoping -- Hoisted Jest factories are self-contained. */
jest.mock('../Shared/UsernameLink', () => () => null);
/* eslint-enable unicorn/consistent-function-scoping */
const deferred = () => {
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
};

const row = (id) => ({
  id,
  username: 'peer',
  filename: id,
  stateDescription: 'Completed, Succeeded',
  direction: 'Upload',
  endedAt: '2026-10-27T10:00:00Z',
});
describe('Transfer history loading', () => {
  let container;
  const button = (text) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text,
    );
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    reports.getTransferHistory.mockResolvedValue({ items: [], total: 0 });
    reports.getTransferAttempts.mockResolvedValue([]);
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<TransferHistory />, container);
    });
  };

  const click = async (text) => {
    await act(async () => {
      Simulate.click(button(text));
    });
  };

  it('shows the resume offset and excludes it from bytes sent', async () => {
    expect.hasAssertions();
    reports.getTransferHistory.mockResolvedValue({
      items: [
        {
          ...row('resumed'),
          size: 4_096,
          startOffset: 3_072,
          bytesTransferred: 4_096,
        },
      ],
      total: 1,
    });
    await render();
    act(() => {
      Simulate.click(container.querySelector('.th-transfer-row'));
    });
    const details = document.querySelector('.th-detail-grid');
    expect(details.textContent).toContain('Resume offset3 KB');
    expect(details.textContent).toContain('Bytes sent1 KB');
  });

  it('coalesces completion bursts and polling while a request is pending', async () => {
    expect.hasAssertions();
    const pending = deferred();
    reports.getTransferHistory.mockReturnValue(pending.promise);
    await render();
    await act(async () => {
      for (let index = 0; index < 20; index++) emitTransferComplete({});
      jest.advanceTimersByTime(31_000);
    });
    expect(reports.getTransferHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ items: [row('finished')], total: 1 });
    });
    expect(container.textContent).toContain('finished');
  });
  it('aborts obsolete filters and ignores their late responses', async () => {
    expect.hasAssertions();
    const old = deferred();
    reports.getTransferHistory
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ items: [row('new-filter')], total: 1 });
    await render();
    const first = reports.getTransferHistory.mock.calls[0][0];
    await click('Uploads');
    expect(first.signal.aborted).toBe(true);
    await act(async () => {
      old.resolve({ items: [row('obsolete')], total: 1 });
    });
    expect(container.textContent).toContain('new-filter');
    expect(container.textContent).not.toContain('obsolete');
  });
  it('keeps a stable time window on later pages and background refreshes', async () => {
    expect.hasAssertions();
    reports.getTransferHistory.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => row(String(index))),
      total: 51,
    });
    await render();
    const first = reports.getTransferHistory.mock.calls[0][0];
    await click('Next ›');
    const next = reports.getTransferHistory.mock.calls.at(-1)[0];
    expect(next.offset).toBe(50);
    expect(next.start).toBe(first.start);
    expect(next.end).toBe(first.end);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(reports.getTransferHistory.mock.calls.at(-1)[0].end).toBe(first.end);
  });
  it('keeps visible history when a background refresh fails', async () => {
    expect.hasAssertions();
    reports.getTransferHistory
      .mockResolvedValueOnce({ items: [row('keep-me')], total: 1 })
      .mockRejectedValue(new Error('offline'));
    await render();
    await click('Refresh');
    expect(container.textContent).toContain('keep-me');
    expect(container.textContent).toContain('offline');
  });
  it('skips background refresh when hidden and aborts on unmount', async () => {
    expect.hasAssertions();
    await render();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    await act(async () => {
      emitTransferComplete({});
      jest.advanceTimersByTime(30_000);
    });
    expect(reports.getTransferHistory).toHaveBeenCalledTimes(1);
    const pending = deferred();
    reports.getTransferHistory.mockReturnValue(pending.promise);
    await click('Downloads');
    const current = reports.getTransferHistory.mock.calls.at(-1)[0];
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(current.signal.aborted).toBe(true);
    pending.resolve({ items: [], total: 0 });
  });
  it('loads only the first page once when a debounced search changes on a later page', async () => {
    expect.hasAssertions();
    reports.getTransferHistory.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => row(String(index))),
      total: 51,
    });
    await render();
    await click('Next ›');
    const before = reports.getTransferHistory.mock.calls.length;
    await act(async () => {
      Simulate.change(container.querySelector('input'), {
        target: { value: 'needle' },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(350);
    });
    expect(reports.getTransferHistory).toHaveBeenCalledTimes(before + 1);
    expect(reports.getTransferHistory.mock.calls.at(-1)[0]).toEqual(
      expect.objectContaining({ search: 'needle', offset: 0 }),
    );
  });

  it('uses the all-failures filter rather than matching the word Failed in internal descriptions', async () => {
    expect.hasAssertions();
    await render();
    await click('Failed');
    expect(reports.getTransferHistory.mock.calls.at(-1)[0].state).toBe(
      'Failed',
    );
  });
});
