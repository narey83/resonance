import { getStatus } from '../../lib/users';
import DownloadsTable from './DownloadsTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../Shared', () => ({
  UsernameLink: ({ username }) => (
    <span className="test-user-controls">
      {username}
      <button
        title="Chat"
        type="button"
      >
        Chat
      </button>
    </span>
  ),
}));
jest.mock('./PeerUploadSlots', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../lib/users', () => ({ getStatus: jest.fn() }));
jest.mock('../../lib/network', () => ({ lookupIp: jest.fn() }));
jest.mock('@tanstack/react-virtual', () => ({ useVirtualizer: jest.fn() }));
const file = (id, username, state = 'Queued') => ({
  id,
  username,
  direction: 'Download',
  state,
  filename: `Music/Album/Track ${id}.flac`,
  size: 1_024,
  requestedAt: '2026-11-02T12:00:00Z',
});
const sample = () => [
  {
    username: 'bravo',
    directories: [{ directory: 'Music/Bravo', files: [file('b1', 'bravo')] }],
  },
  {
    username: 'alpha',
    directories: [
      {
        directory: 'Music/Album',
        files: [file('a1', 'alpha', 'InProgress'), file('a2', 'alpha')],
      },
      {
        directory: 'Music/Finished',
        files: [file('a3', 'alpha', 'Completed, Succeeded')],
      },
      {
        directory: 'Music/Failed',
        files: [file('a4', 'alpha', 'Completed, Errored')],
      },
    ],
  },
  {
    username: 'charlie',
    directories: [
      {
        directory: 'Music/Charlie',
        files: [file('c1', 'charlie', 'Completed, TimedOut')],
      },
    ],
  },
];

describe('Downloads recipient workspace', () => {
  let container;
  let actions;
  beforeEach(() => {
    useVirtualizer.mockImplementation(({ count, getItemKey }) => ({
      getTotalSize: () => count * 56,
      getVirtualItems: () =>
        Array.from({ length: Math.min(count, 60) }, (_, index) => ({
          index,
          key: getItemKey(index),
          start: index * 56,
        })),
      measureElement: () => {},
    }));
    getStatus.mockResolvedValue({ data: { presence: 'Online' } });
    actions = Object.fromEntries(
      [
        'onCancel',
        'onCancelDirectory',
        'onCancelUser',
        'onClearCompleted',
        'onFindAlternate',
        'onRemove',
        'onRetry',
        'onRetryBatch',
      ].map((name) => [name, jest.fn()]),
    );
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (transfers = sample()) => {
    await act(async () => {
      ReactDOM.render(
        <DownloadsTable
          {...actions}
          transfers={transfers}
        />,
        container,
      );
    });
  };

  const clickText = (text) =>
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent.trim() === text,
        ),
      ),
    );
  const choose = (name) =>
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('.ul-live-user')].find(
          (button) => button.querySelector('strong').textContent === name,
        ),
      ),
    );
  const folder = (name) =>
    [...container.querySelectorAll('.dl-dir-toggle')].find(
      (button) => button.querySelector('.dl-dir-label').textContent === name,
    );

  it('shows every user, matching counts, one selected-user control group and closed folders', async () => {
    expect.hasAssertions();
    await render();
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(3);
    expect(
      container.querySelector('.ul-live-user[aria-pressed="true"] strong')
        .textContent,
    ).toBe('alpha');
    expect(container.querySelector('.ul-toolbar').textContent).toContain(
      'All downloads: 6 tracks',
    );
    expect(
      container.querySelector('.ul-live-user[aria-pressed="true"]').textContent,
    ).toContain(
      '4 tracks · 1 waiting · 1 downloading/connecting · 1 failed · 1 finished',
    );
    expect(container.querySelectorAll('.test-user-controls')).toHaveLength(1);
    expect(
      container.querySelectorAll('.dl-dir-toggle[aria-expanded="false"]'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('.dl-folder-scroll .dl-file-row'),
    ).toHaveLength(0);
    expect(
      container.querySelector('[aria-label="Current downloads"]').textContent,
    ).toContain('Track a1.flac');
    expect(
      container.querySelector('[aria-label="Current downloads"]').textContent,
    ).toContain('From: Album');
    expect(
      container.querySelector('[aria-label="Current downloads"]').textContent,
    ).not.toContain('Music/Album');
    expect(container.querySelector('select')).toBeNull();
  });
  it('expands tracks on demand and resets folders when switching users', async () => {
    expect.hasAssertions();
    await render();
    act(() => Simulate.click(folder('Album')));
    expect(
      container.querySelectorAll('.dl-folder-scroll .dl-file-row'),
    ).toHaveLength(2);
    expect(folder('Album').getAttribute('aria-expanded')).toBe('true');
    choose('bravo');
    expect(
      container.querySelector('.test-user-controls').textContent,
    ).toContain('bravo');
    expect(
      container.querySelectorAll('.dl-folder-scroll .dl-file-row'),
    ).toHaveLength(0);
    choose('alpha');
    expect(folder('Album').getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps the selected user when new users arrive and recovers when they disappear', async () => {
    expect.hasAssertions();
    await render();
    choose('bravo');
    const newcomer = {
      username: 'newcomer',
      directories: [
        {
          directory: 'Music/New',
          files: [file('n1', 'newcomer', 'InProgress')],
        },
      ],
    };
    await render([newcomer, ...sample()]);
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(4);
    expect(
      container.querySelector('.test-user-controls').textContent,
    ).toContain('bravo');
    await render([newcomer]);
    expect(
      container.querySelector('.test-user-controls').textContent,
    ).toContain('newcomer');
  });
  it('filters folders within the selected user while keeping current downloads visible', async () => {
    expect.hasAssertions();
    await render();
    clickText('Done1');
    expect(container.querySelectorAll('.dl-dir-toggle')).toHaveLength(1);
    expect(folder('Finished')).toBeDefined();
    expect(
      container.querySelector('[aria-label="Current downloads"]').textContent,
    ).toContain('Track a1.flac');
    choose('charlie');
    expect(
      container.querySelector('.dl-filter-pill[aria-pressed="true"]')
        .textContent,
    ).toBe('All1');
    clickText('Downloading0');
    expect(container.querySelector('.dl-filter-empty').textContent).toContain(
      'No folders match',
    );
  });
  it('retains whole-user and global retry/cancel scopes, including completed folders for active users', async () => {
    expect.hasAssertions();
    await render();
    act(() =>
      Simulate.click(
        container.querySelector('.dl-user-header .dl-action-btn--retry'),
      ),
    );
    expect(
      actions.onRetryBatch.mock.calls[0][0].map((entry) => entry.id),
    ).toEqual(['a4']);
    clickText('Retry all failed');
    expect(
      actions.onRetryBatch.mock.calls[1][0].map((entry) => entry.id).sort(),
    ).toEqual(['a4', 'c1']);
    act(() =>
      Simulate.click(
        container.querySelector('.dl-user-header .dl-action-btn--cancel'),
      ),
    );
    expect(actions.onCancelUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alpha',
        directories: expect.any(Array),
      }),
    );
    clickText('Cancel all unfinished');
    expect(actions.onCancel).toHaveBeenCalledTimes(3);
    clickText('Clear finished');
    expect(actions.onClearCompleted).toHaveBeenCalledTimes(1);
  });
  it('preserves file and folder actions and alternative-source search', async () => {
    expect.hasAssertions();
    await render();
    act(() => Simulate.click(folder('Album')));
    act(() =>
      Simulate.click(
        container.querySelector(
          '.dl-folder-scroll [data-download-id="a2"] [title="Cancel"]',
        ),
      ),
    );
    expect(actions.onCancel).toHaveBeenCalledWith({
      file: expect.objectContaining({ id: 'a2' }),
    });
    act(() => Simulate.click(folder('Failed')));
    act(() =>
      Simulate.click(
        container.querySelector('[data-download-id="a4"] [title="Retry"]'),
      ),
    );
    expect(actions.onRetry).toHaveBeenCalledWith({
      file: expect.objectContaining({ id: 'a4' }),
    });
    act(() =>
      Simulate.click(
        container.querySelector('[data-download-id="a4"] [title="Remove"]'),
      ),
    );
    expect(actions.onRemove).toHaveBeenCalledWith({
      file: expect.objectContaining({ id: 'a4' }),
    });
    act(() =>
      Simulate.click(
        container.querySelector('[title="Find folder from another source"]'),
      ),
    );
    expect(actions.onFindAlternate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alpha',
        directory: 'Music/Failed',
        folderName: 'Failed',
      }),
    );
    act(() =>
      Simulate.click(
        folder('Album')
          .closest('tr')
          .querySelector('[title="Cancel and delete folder"]'),
      ),
    );
    expect(actions.onCancelDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alpha', directory: 'Music/Album' }),
    );
  });
  it('includes every expanded track in the virtual list without a load-more limit', async () => {
    expect.hasAssertions();
    await render([
      {
        username: 'bulk',
        directories: [
          {
            directory: 'Music/Bulk',
            files: Array.from({ length: 1_000 }, (_, index) =>
              file(String(index), 'bulk'),
            ),
          },
        ],
      },
    ]);
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(0);
    act(() => Simulate.click(folder('Bulk')));
    const options = useVirtualizer.mock.calls.at(-1)[0];
    expect(options.count).toBe(1_001);
    expect(options.getItemKey(1_000)).toBe('file-999');
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(59);
    expect(container.querySelector('.dl-show-more-btn')).toBeNull();
  });
  it('shows a useful empty state and accepts downloads arriving later', async () => {
    expect.hasAssertions();
    await render([]);
    expect(container.querySelector('.dl-empty').textContent).toContain(
      'New users will appear here',
    );
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(0);
    await render(sample());
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(3);
  });
});
