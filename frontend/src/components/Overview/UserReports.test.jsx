import * as reports from '../../lib/reports';
import { emitTransferComplete } from '../../lib/transferEvents';
import UserReports from './UserReports';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/reports', () => ({ getUserList: jest.fn() }));
/* eslint-disable unicorn/consistent-function-scoping -- Hoisted Jest factories must remain self-contained. */
jest.mock(
  '../Shared/UsernameLink',
  () =>
    ({ username }) =>
      username,
);
/* eslint-enable unicorn/consistent-function-scoping */
const deferred = () => {
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
};

const rows = [{ username: 'visible-peer', lastSeen: '2026-10-27T10:00:00Z' }];
describe('Users report request lifecycle', () => {
  let container;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    window.history.replaceState({}, '', '/overview');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    reports.getUserList.mockResolvedValue({ items: rows, total: 100 });
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
      ReactDOM.render(<UserReports />, container);
    });
  };

  it('does not overlap refreshes from completion bursts and polling', async () => {
    expect.hasAssertions();
    const pending = deferred();
    reports.getUserList.mockReturnValue(pending.promise);
    await render();
    await act(async () => {
      for (let index = 0; index < 20; index++) emitTransferComplete({});
      jest.advanceTimersByTime(31_000);
    });
    expect(reports.getUserList).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ items: rows, total: 100 });
    });
    expect(container.textContent).toContain('visible-peer');
  });
  it('cancels an obsolete search and ignores its late response', async () => {
    expect.hasAssertions();
    const pending = deferred();
    reports.getUserList
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ items: rows, total: 1 });
    await render();
    const initial = reports.getUserList.mock.calls[0][0];
    await act(async () => {
      Simulate.change(container.querySelector('.user-reports-search'), {
        target: { value: 'visible' },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(initial.signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ items: [{ username: 'obsolete' }], total: 1 });
    });
    expect(container.textContent).toContain('visible-peer');
    expect(container.textContent).not.toContain('obsolete');
  });
  it('batches debounced search and page reset into one request', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => {
      Simulate.click(container.querySelector('[title="Next page"]'));
    });
    const before = reports.getUserList.mock.calls.length;
    await act(async () => {
      Simulate.change(container.querySelector('.user-reports-search'), {
        target: { value: 'needle' },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(reports.getUserList).toHaveBeenCalledTimes(before + 1);
    expect(reports.getUserList.mock.calls.at(-1)[0]).toEqual(
      expect.objectContaining({ search: 'needle', offset: 0 }),
    );
  });
  it('retains visible users when background refresh fails', async () => {
    expect.hasAssertions();
    await render();
    reports.getUserList.mockRejectedValue(new Error('offline'));
    await act(async () => {
      emitTransferComplete({});
    });
    expect(container.textContent).toContain('visible-peer');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'offline',
    );
  });
  it('skips hidden-tab refreshes and cancels pending debounce on unmount', async () => {
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
    expect(reports.getUserList).toHaveBeenCalledTimes(1);
    await act(async () => {
      Simulate.change(container.querySelector('.user-reports-search'), {
        target: { value: 'pending' },
      });
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(reports.getUserList).toHaveBeenCalledTimes(1);
  });
  it('starts with a seven-day window and keeps it stable while paging', async () => {
    expect.hasAssertions();
    await render();
    const first = reports.getUserList.mock.calls[0][0];
    expect(new Date(first.end) - new Date(first.start)).toBe(7 * 86_400_000);
    await act(async () => {
      Simulate.click(container.querySelector('[title="Next page"]'));
    });
    const next = reports.getUserList.mock.calls.at(-1)[0];
    expect(next.start).toBe(first.start);
    expect(next.end).toBe(first.end);
    expect(next.offset).toBe(50);
  });
  it('retains explicit access to all history', async () => {
    expect.hasAssertions();
    await render();
    const all = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'All history',
    );
    await act(async () => {
      Simulate.click(all);
    });
    const query = reports.getUserList.mock.calls.at(-1)[0];
    expect(query.start).toBeUndefined();
    expect(query.end).toBeUndefined();
    expect(query.offset).toBe(0);
  });
  it('preserves all-history behavior for a direct user link', async () => {
    expect.hasAssertions();
    window.history.replaceState({}, '', '/overview?user=someone');
    await render();
    const query = reports.getUserList.mock.calls[0][0];
    expect(query.search).toBe('someone');
    expect(query.start).toBeUndefined();
    expect(query.end).toBeUndefined();
  });
});
