import * as prefs from '../../lib/prefs';
import { getUploadFolder } from '../../lib/transfers';
import { getStatuses } from '../../lib/users';
import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/transfers', () => ({
  ...jest.requireActual('../../lib/transfers'),
  getUploadFolder: jest.fn(),
}));
jest.mock('../../lib/prefs', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../lib/users', () => ({
  getStatuses: jest.fn().mockResolvedValue({}),
}));
jest.mock('../Shared', () => ({
  UsernameLink: ({ username }) => (
    <span className="test-user-controls">{username}</span>
  ),
}));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }) => ({
    getTotalSize: () => count * 56,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: index * 56,
      })),
    measureElement: () => {},
  }),
}));

const file = (id, state = 'Queued') => ({
  id,
  state,
  direction: 'Upload',
  username: 'listener',
  filename: `Music/Album/Track ${id}.flac`,
  size: 1_024,
});
const users = [
  { username: 'listener', waitingCount: 2, activeCount: 1, sendingCount: 1 },
  { username: 'other', waitingCount: 3, activeCount: 0, sendingCount: 0 },
  { username: 'connecting', waitingCount: 1, activeCount: 1, sendingCount: 0 },
];
const transfers = [
  {
    username: 'listener',
    directories: [
      {
        directory: 'Music/Album',
        files: [file('active', 'InProgress'), file('waiting')],
      },
    ],
  },
];

describe('Uploads recipient cards', () => {
  let container;
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <UploadsTable
          queueUsers={users}
          selectedUsername="listener"
          transfers={transfers}
          {...props}
        />,
        container,
      );
    });
  };

  const chooseStatus = (status) =>
    act(() =>
      Simulate.click(
        container.querySelector(
          `.ul-recipient-status button[value="${status}"]`,
        ),
      ),
    );
  const openUser = (username = 'listener') =>
    act(() =>
      Simulate.click(
        container.querySelector(`[aria-label="View uploads for ${username}"]`),
      ),
    );

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    prefs.get.mockReset().mockReturnValue(null);
    prefs.set.mockReset();
    getStatuses.mockReset().mockResolvedValue({});
    getUploadFolder.mockReset();
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });

  it('keeps connecting transfers under the Downloading label', async () => {
    expect.hasAssertions();
    await render();
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Downloading (2)');
    expect(
      Array.from(
        container.querySelectorAll('.ul-user-card-name'),
        (node) => node.textContent,
      ),
    ).toEqual(['listener', 'connecting']);
    expect(container.querySelectorAll('.ul-user-card-status')).toHaveLength(2);
    expect(
      Array.from(
        container.querySelectorAll('.ul-user-card-status'),
        (node) => node.textContent,
      ),
    ).toEqual(['Downloading', 'Downloading']);
    expect(
      Array.from(
        container.querySelectorAll('.ul-user-card-stats'),
        (node) => node.textContent,
      ).join(' '),
    ).not.toContain('connecting');
    expect(container.querySelector('.ul-detail-view')).toBeNull();
    expect(
      Array.from(
        container.querySelectorAll('[role="menuitemradio"]'),
        (node) => node.value,
      ),
    ).toEqual(['Downloading', 'Waiting']);
  });

  it('holds a recipient in Downloading across short gaps, then returns them to Waiting', async () => {
    expect.hasAssertions();
    const now = jest.spyOn(Date, 'now').mockReturnValue(100_000);
    await render({ queueUsers: users.slice(0, 2) });
    const idle = { ...users[0], activeCount: 0, sendingCount: 0 };
    now.mockReturnValue(102_000);
    await render({ queueUsers: [idle, users[1]] });
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Downloading (1)');
    expect(container.querySelector('.ul-user-card-name').textContent).toBe(
      'listener',
    );
    expect(container.querySelector('.ul-user-card-status').textContent).toBe(
      'Downloading',
    );
    now.mockReturnValue(129_999);
    await render({ queueUsers: [idle, users[1]] });
    expect(container.querySelectorAll('.ul-user-card')).toHaveLength(1);
    now.mockReturnValue(130_001);
    await render({ queueUsers: [idle, users[1]] });
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Downloading (0)');
    chooseStatus('Waiting');
    expect(container.querySelectorAll('.ul-user-card')).toHaveLength(2);
  });

  it('shows waiting cards and presence, then returns to downloading cards after closing details', async () => {
    expect.hasAssertions();
    getStatuses.mockResolvedValue({ other: { presence: 'Online' } });
    await render();
    chooseStatus('Waiting');
    expect(container.querySelector('.ul-card-view-header h1').textContent).toBe(
      'People waiting for your music',
    );
    expect(container.querySelectorAll('.ul-user-card')).toHaveLength(1);
    expect(container.querySelector('.ul-user-card').textContent).toContain(
      'Online',
    );
    openUser('other');
    expect(container.textContent).toContain('Loading uploads for other');
    await render({ selectedUsername: 'other', transfers: [] });
    expect(container.querySelector('.ul-detail-view')).not.toBeNull();
    act(() => Simulate.click(container.querySelector('.ul-back-button')));
    expect(container.querySelector('.ul-detail-view')).toBeNull();
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Downloading (2)');
  });

  it('requests another recipient only after opening their card and keeps stale tracks hidden', async () => {
    expect.hasAssertions();
    const onSelectUploadUser = jest.fn();
    await render({ onSelectUploadUser });
    openUser('connecting');
    expect(onSelectUploadUser).toHaveBeenCalledWith('connecting');
    expect(container.textContent).toContain('Loading uploads for connecting');
    expect(container.querySelector('.ul-complete-table')).toBeNull();
    await render({
      onSelectUploadUser,
      selectedUsername: 'connecting',
      transfers: [],
    });
    expect(container.textContent).toContain(
      'No unfinished uploads for this user',
    );
  });

  it('restores saved waiting choice and ignores the removed connecting choice', async () => {
    expect.hasAssertions();
    prefs.get.mockReturnValue('Waiting');
    await render();
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Waiting (1)');
    expect(prefs.set).not.toHaveBeenCalled();
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    prefs.get.mockReturnValue('Connecting');
    await render();
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Downloading (2)');
    expect(prefs.set).not.toHaveBeenCalled();
  });

  it('opens the existing upload queue, fetches folder tracks lazily and preserves cancellation', async () => {
    expect.hasAssertions();
    const onCancel = jest.fn();
    const onCancelDirectory = jest.fn();
    const onCancelUser = jest.fn();
    getUploadFolder.mockResolvedValue([
      file('active', 'InProgress'),
      file('waiting'),
    ]);
    await render({
      folders: [{ directory: 'Music/Album', fileCount: 2, activeCount: 1 }],
      onCancel,
      onCancelDirectory,
      onCancelUser,
    });
    openUser();
    expect(
      container.querySelector('[data-current-upload-id="active"]'),
    ).not.toBeNull();
    expect(getUploadFolder).not.toHaveBeenCalled();
    await act(async () =>
      Simulate.click(container.querySelector('.ul-folder-toggle')),
    );
    expect(getUploadFolder).toHaveBeenCalledWith({
      directory: 'Music/Album',
      signal: expect.any(AbortSignal),
      username: 'listener',
    });
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(2);
    act(() =>
      Simulate.click(
        container.querySelector('[aria-label="Cancel Track waiting.flac"]'),
      ),
    );
    expect(onCancel).toHaveBeenCalledWith({
      file: expect.objectContaining({ id: 'waiting' }),
    });
    act(() => Simulate.click(container.querySelector('.ul-folder-block')));
    expect(onCancelDirectory).toHaveBeenCalledWith({
      directory: 'Music/Album',
      fileCount: 2,
      username: 'listener',
    });
    act(() =>
      Simulate.click(
        container.querySelector('.ul-complete-header .ul-quick-btn'),
      ),
    );
    expect(onCancelUser).toHaveBeenCalledWith({
      fileCount: 2,
      username: 'listener',
    });
  });

  it('shows an empty card state without loading a detail pane', async () => {
    expect.hasAssertions();
    await render({ queueUsers: [], selectedUsername: null, transfers: [] });
    expect(container.textContent).toContain('No users downloading.');
    expect(container.querySelector('.ul-user-card')).toBeNull();
    expect(container.querySelector('.ul-complete-table')).toBeNull();
  });

  it('keeps active progress above closed folders and excludes completed uploads', async () => {
    expect.hasAssertions();
    await render({
      transfers: [
        {
          username: 'listener',
          directories: [
            {
              directory: 'Music/Album',
              files: [
                { ...file('active', 'InProgress'), percentComplete: 42 },
                file('waiting'),
                file('finished', 'Completed, Succeeded'),
              ],
            },
          ],
        },
      ],
    });
    openUser();
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
    expect(
      container.querySelector('.ul-current-uploads').textContent,
    ).toContain('42%');
    expect(container.querySelector('.ul-current-source').textContent).toBe(
      'From: Album',
    );
    expect(container.textContent).not.toContain('Track finished.flac');
    act(() => Simulate.click(container.querySelector('.ul-folder-toggle')));
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(2);
    act(() => Simulate.click(container.querySelector('.ul-folder-toggle')));
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
  });

  it('shows a retry time only in the opened recipient details', async () => {
    expect.hasAssertions();
    const retryAt = '2026-11-03T10:35:00+00:00';
    await render({ queueUsers: [{ ...users[0], retryAt }, users[1]] });
    openUser();
    expect(container.querySelector('time').dateTime).toBe(retryAt);
    expect(container.textContent).toContain(
      'Paused after repeated transfer failures',
    );
    act(() => Simulate.click(container.querySelector('.ul-back-button')));
    expect(container.querySelector('time')).toBeNull();
  });

  it('keeps the dropdown usable without preference storage', async () => {
    expect.hasAssertions();
    prefs.get.mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    await render();
    chooseStatus('Waiting');
    expect(
      container.querySelector('.ul-recipient-status').textContent,
    ).toContain('Waiting (1)');
    expect(prefs.set).toHaveBeenCalledWith(
      'resonance-uploads-recipient-status',
      'Waiting',
    );
  });

  it('supports keyboard navigation and Escape in the status dropdown', async () => {
    expect.hasAssertions();
    await render();
    const summary = container.querySelector('.ul-recipient-status > summary');
    const dropdown = summary.parentElement;
    summary.focus();
    act(() => Simulate.keyDown(summary, { key: 'ArrowDown' }));
    expect(dropdown.open).toBe(true);
    expect(document.activeElement.value).toBe('Downloading');
    act(() => Simulate.keyDown(document.activeElement, { key: 'ArrowDown' }));
    expect(document.activeElement.value).toBe('Waiting');
    act(() => Simulate.keyDown(document.activeElement, { key: 'Escape' }));
    expect(dropdown.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});
