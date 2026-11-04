import { getAll, getUploadsQueue } from '../../lib/transfers';
import DownloadsTable from './DownloadsTable';
import Transfers from './Transfers';
import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/completeUploadQueue', () => ({
  getCompleteUploadsQueue: jest.fn(),
}));
jest.mock('./UploadsTable', () => ({
  __esModule: true,
  default: jest.fn(() => 'Upload queue'),
}));
jest.mock('../../lib/transfers', () => ({
  getAll: jest.fn(),
  getUploadsQueue: jest.fn(),
}));
jest.mock('./DownloadsTable', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('./FindAlternateModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('Transfer loading state', () => {
  let container;
  let finish;
  let fail;
  beforeEach(() => {
    jest.clearAllMocks();
    UploadsTable.mockImplementation(() => 'Upload queue');
    DownloadsTable.mockImplementation(() => 'Download queue');
    container = document.createElement('div');
    document.body.append(container);
    const pending = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    getUploadsQueue.mockReturnValue(pending);
    getAll.mockReturnValue(pending);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });
  it.each([
    {
      direction: 'upload',
      label: 'Loading uploads…',
      queue: 'Upload queue',
      response: { users: [], transfers: [], username: null, folders: [] },
      method: getUploadsQueue,
    },
    {
      direction: 'download',
      label: 'Loading downloads…',
      queue: 'Download queue',
      response: [],
      method: getAll,
    },
  ])(
    'shows the $direction loading graphic until its queue arrives',
    async ({ direction, label, method, queue, response }) => {
      expect.hasAssertions();
      await act(async () => {
        ReactDOM.render(<Transfers direction={direction} />, container);
      });
      const status = container.querySelector('[role="status"]');
      expect(status.className).toBe('transfers-loading');
      expect(status.getAttribute('aria-busy')).toBe('true');
      expect(
        status.querySelector('img.resonance-mark[aria-hidden="true"]'),
      ).not.toBeNull();
      expect(status.textContent).toBe(label);
      expect(UploadsTable).not.toHaveBeenCalled();
      expect(DownloadsTable).not.toHaveBeenCalled();
      expect(method).toHaveBeenCalledTimes(1);
      await act(async () => finish(response));
      expect(container.querySelector('.transfers-loading')).toBeNull();
      expect(container.textContent).toBe(queue);
    },
  );
  it('replaces the loading graphic with the retry message when loading fails', async () => {
    expect.hasAssertions();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      ReactDOM.render(<Transfers direction="upload" />, container);
    });
    await act(async () => fail(new Error('offline')));
    expect(container.querySelector('.transfers-loading')).toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toContain(
      'Unable to load',
    );
    expect(UploadsTable).not.toHaveBeenCalled();
  });
});
