import { getCompleteUploadsQueue } from '../../lib/completeUploadQueue';
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
jest.mock('../Shared', () => ({ LoaderSegment: () => null }));
jest.mock('./FindAlternateModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('Uploads loading state', () => {
  let container;
  let finish;
  let fail;
  beforeEach(() => {
    jest.clearAllMocks();
    UploadsTable.mockImplementation(() => 'Upload queue');
    container = document.createElement('div');
    document.body.append(container);
    getCompleteUploadsQueue.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
  });
  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
    jest.restoreAllMocks();
  });
  it('shows one accessible graphic while waiting and replaces it with the queue', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<Transfers direction="upload" />, container);
    });
    const status = container.querySelector('[role="status"]');
    expect(status.className).toBe('transfers-loading');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(status.textContent).toBe('Loading uploads…');
    expect(UploadsTable).not.toHaveBeenCalled();
    await act(async () => finish({ users: [], transfers: [], username: null }));
    expect(container.querySelector('.transfers-loading')).toBeNull();
    expect(container.textContent).toBe('Upload queue');
  });
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
