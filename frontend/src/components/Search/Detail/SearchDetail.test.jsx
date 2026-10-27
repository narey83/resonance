import { getResponses } from '../../../lib/searches';
import * as transfers from '../../../lib/transfers';
import { getStatus } from '../../../lib/users';
import { sleep } from '../../../lib/util';
import SearchDetail from './SearchDetail';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/PlayerContext', () => ({
  usePlayer: () => ({ play: jest.fn() }),
}));
jest.mock('../../../lib/searches', () => ({ getResponses: jest.fn() }));
jest.mock('../../../lib/transfers', () => ({
  getAll: jest.fn().mockResolvedValue([]),
  download: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../lib/users', () => ({
  getStatus: jest.fn().mockResolvedValue({ data: { presence: 'Online' } }),
}));
jest.mock('../../../lib/util', () => ({
  ...jest.requireActual('../../../lib/util'),
  sleep: jest.fn().mockResolvedValue(),
}));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 100,
      })),
    measureElement: jest.fn(),
  }),
}));
jest.mock('../../Shared/UsernameLink', () => ({ username }) => (
  <span>{username}</span>
));
jest.mock('./SearchDetailHeader', () => 'mock-search-header');
jest.mock(
  './FolderPickerModal',
  () =>
    ({ onConfirm, open }) =>
      open ? (
        <button
          onClick={() => onConfirm('chosen-folder')}
          type="button"
        >
          Confirm destination
        </button>
      ) : null,
);

const filename = 'Music\\Artist - Album\\01 - Track.flac';
const responses = ['alice', 'bob'].map((username) => ({
  username,
  hasFreeUploadSlot: true,
  uploadSpeed: 1_000,
  queueLength: 0,
  fileCount: 1,
  lockedFileCount: 0,
  files: [{ filename, size: 1_000, length: 0 }],
}));

describe('release-first results', () => {
  let container;
  beforeEach(async () => {
    jest.clearAllMocks();
    getResponses.mockResolvedValue(responses);
    transfers.getAll.mockResolvedValue([]);
    transfers.download.mockResolvedValue({});
    getStatus.mockResolvedValue({ data: { presence: 'Online' } });
    sleep.mockResolvedValue();
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      ReactDOM.render(
        <SearchDetail
          search={{
            id: 'test',
            searchText: 'Artist',
            isComplete: true,
            fileCount: 2,
            lockedFileCount: 0,
          }}
        />,
        container,
      );
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const click = (text) =>
    act(async () =>
      Simulate.click(
        [...container.querySelectorAll('button')].find((button) =>
          button.textContent.includes(text),
        ),
      ),
    );
  it('shows files immediately and keeps identical folder paths from different users as separate sources', async () => {
    expect.hasAssertions();
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(2);
    expect(container.textContent).toContain('2 shown · 2 received · 1 release');
    expect(container.querySelectorAll('.sr-folder-group')).toHaveLength(2);
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('bob');
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(2);
  });
  it('chooses a single source and confirms a destination before queuing its files', async () => {
    expect.hasAssertions();
    await click('Download files');
    expect(transfers.download).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Confirm destination',
        ),
      );
    });
    expect(transfers.download).toHaveBeenCalledTimes(1);
    expect(transfers.download).toHaveBeenCalledWith({
      username: 'alice',
      destinationFolder: 'chosen-folder',
      files: [{ filename, size: 1_000 }],
    });
  });
  it('offers the compact file view and renders unknown durations without a false zero', async () => {
    expect.hasAssertions();
    await click('Compact files');
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(2);
    expect(
      container.querySelector('.sr-file-row .sr-file-length').textContent,
    ).toBe('—');
    expect(container.querySelector('.sr-filters').hidden).toBe(true);
    await click('Refine');
    expect(container.querySelector('.sr-filters').hidden).toBe(false);
  });
});
