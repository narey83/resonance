import * as api from '../../lib/transfers';
import Transfers from './Transfers';
import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/transfers', () => ({
  getAll: jest.fn(),
  getUploadsPage: jest.fn(),
}));
jest.mock('./UploadsTable', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('./DownloadsTable', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Shared', () => ({ LoaderSegment: () => null }));
jest.mock('./FindAlternateModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('Uploads page refresh', () => {
  let container;
  let visibility;
  let originalVisibility;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    UploadsTable.mockImplementation(() => null);
    visibility = 'visible';
    originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    container = document.createElement('div');
    document.body.append(container);
    api.getUploadsPage.mockResolvedValue({
      transfers: [],
      totalPending: 1_000,
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
    if (originalVisibility)
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete document.visibilityState;
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<Transfers direction="upload" />, container);
    });
  };

  it('loads bounded pages and aborts the previous page when navigating', async () => {
    expect.hasAssertions();
    await render();
    expect(api.getAll).not.toHaveBeenCalled();
    expect(api.getUploadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, pageSize: 250 }),
    );
    const signal = api.getUploadsPage.mock.calls[0][0].signal;
    await act(async () =>
      UploadsTable.mock.calls.at(-1)[0].onPendingPageChange(1),
    );
    expect(signal.aborted).toBe(true);
    expect(api.getUploadsPage.mock.calls.at(-1)[0].page).toBe(1);
    expect(UploadsTable.mock.calls.at(-1)[0].pendingPage).toBe(1);
  });
  it('does not fetch hidden pages and refreshes immediately when visible again', async () => {
    expect.hasAssertions();
    visibility = 'hidden';
    await render();
    expect(api.getUploadsPage).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(6_000);
    });
    expect(api.getUploadsPage).not.toHaveBeenCalled();
    visibility = 'visible';
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    expect(api.getUploadsPage).toHaveBeenCalledTimes(1);
  });
  it('does not overlap slow requests and cancels one on unmount', async () => {
    expect.hasAssertions();
    let finish;
    api.getUploadsPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    const signal = api.getUploadsPage.mock.calls[0][0].signal;
    await act(async () => {
      jest.advanceTimersByTime(12_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(api.getUploadsPage).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ transfers: [], totalPending: 0 }));
    expect(UploadsTable).not.toHaveBeenCalled();
  });
  it('moves back to a valid page after the queue shrinks', async () => {
    expect.hasAssertions();
    await render();
    api.getUploadsPage.mockResolvedValue({ transfers: [], totalPending: 0 });
    await act(async () =>
      UploadsTable.mock.calls.at(-1)[0].onPendingPageChange(3),
    );
    expect(api.getUploadsPage.mock.calls.at(-1)[0].page).toBe(0);
    expect(UploadsTable.mock.calls.at(-1)[0].totalPending).toBe(0);
  });
});
