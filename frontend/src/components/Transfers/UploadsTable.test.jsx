import UploadsTable from './UploadsTable';
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
      <button
        title="Browse files"
        type="button"
      >
        Browse files
      </button>
    </span>
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
const transfers = (files) => [
  { username: 'listener', directories: [{ directory: 'Music/Album', files }] },
];
const users = [
  { username: 'listener', waitingCount: 45, activeCount: 0, pendingCount: 45 },
  { username: 'other', waitingCount: 19, activeCount: 0, pendingCount: 19 },
];
describe('One complete upload list and one user header', () => {
  let container;
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <UploadsTable
          queueUsers={users}
          selectedUsername="listener"
          transfers={[]}
          {...props}
        />,
        container,
      );
    });
  };

  const expandFirst = () =>
    act(() => Simulate.click(container.querySelector('.ul-folder-toggle')));

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  it('defaults to closed folders and expands every track without pagination or duplicate headings', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers(
        Array.from({ length: 45 }, (_, i) => file(String(i))),
      ),
    });
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
    expect(
      container
        .querySelector('.ul-folder-toggle')
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(container.querySelector('.ul-folder-toggle').textContent).toContain(
      '45 tracks',
    );
    expandFirst();
    expect(
      container
        .querySelector('.ul-folder-toggle')
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(45);
    expect(
      container.querySelector('[data-file-id="44"]').textContent,
    ).toContain('Track 44.flac');
    expect(container.querySelector('.ul-complete').dataset.totalTracks).toBe(
      '45',
    );
    expect(container.querySelectorAll('.test-user-controls')).toHaveLength(1);
    expect(
      container
        .querySelector('.ul-complete-header')
        .textContent.match(/listener/gu),
    ).toHaveLength(1);
    expect(
      container.querySelector('.ul-complete-header [title="Chat"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.ul-complete-header [title="Browse files"]'),
    ).not.toBeNull();
    for (const phrase of [
      'on this page',
      'Show more',
      'Waiting to upload',
      'History',
      'Next',
    ])
      expect(container.textContent).not.toContain(phrase);
  });
  it('shows users on the side without a dropdown and switches by clicking a user', async () => {
    expect.hasAssertions();
    const onSelectUploadUser = jest.fn();
    await render({ onSelectUploadUser });
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(2);
    expect(
      container.querySelector('.ul-live-user[aria-pressed="true"]').textContent,
    ).toContain('listener');
    act(() => Simulate.click(container.querySelectorAll('.ul-live-user')[1]));
    expect(onSelectUploadUser).toHaveBeenCalledWith('other');
  });
  it('adds new users to the live side list while retaining the selected user and tracks', async () => {
    expect.hasAssertions();
    const files = transfers([file('one')]);
    await render({ transfers: files });
    expandFirst();
    await render({
      transfers: files,
      queueUsers: [
        ...users,
        {
          username: 'new-arrival',
          waitingCount: 3,
          activeCount: 0,
          pendingCount: 3,
        },
      ],
    });
    expect(container.querySelectorAll('.ul-live-user')).toHaveLength(3);
    expect(
      container.querySelectorAll('.ul-live-user')[2].textContent,
    ).toContain('new-arrival');
    expect(
      container.querySelector('.ul-recipient-controls').textContent,
    ).toContain('listener');
    expect(container.querySelector('[data-file-id="one"]')).not.toBeNull();
    expect(container.querySelectorAll('.test-user-controls')).toHaveLength(1);
  });
  it('keeps whole-user cancellation beside the single header', async () => {
    expect.hasAssertions();
    const onCancelUser = jest.fn();
    const files = [file('one'), file('two')];
    await render({ onCancelUser, transfers: transfers(files) });
    act(() =>
      Simulate.click(
        container.querySelector('.ul-complete-header .ul-quick-btn'),
      ),
    );
    expect(onCancelUser).toHaveBeenCalledWith({
      username: 'listener',
      directories: [{ directory: 'Music/Album', files }],
    });
  });
  it('preserves individual file and permanent folder-block actions', async () => {
    expect.hasAssertions();
    const onCancel = jest.fn();
    const onCancelDirectory = jest.fn();
    const track = file('one');
    await render({
      onCancel,
      onCancelDirectory,
      transfers: transfers([track]),
    });
    expandFirst();
    act(() =>
      Simulate.click(
        container.querySelector('[aria-label="Cancel Track one.flac"]'),
      ),
    );
    expect(onCancel).toHaveBeenCalledWith({ file: track });
    act(() => Simulate.click(container.querySelector('.ul-folder-block')));
    expect(onCancelDirectory).toHaveBeenCalledWith({
      username: 'listener',
      directory: 'Music/Album',
      files: [track],
    });
  });
  it('shows live progress in the same list while excluding finished records', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers([
        file('waiting'),
        {
          ...file('active', 'InProgress'),
          percentComplete: 25,
          bytesTransferred: 256,
        },
        file('old', 'Completed, Succeeded'),
      ]),
    });
    expect(container.querySelector('.ul-folder-toggle').textContent).toContain(
      '1 sending/connecting',
    );
    expandFirst();
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(2);
    expect(
      container.querySelector('[data-file-id="active"]').textContent,
    ).toContain('25%');
    expect(container.textContent).not.toContain('Track old.flac');
  });
  it('collapses independently and defaults closed when switching recipients', async () => {
    expect.hasAssertions();
    const props = {
      transfers: [
        {
          username: 'listener',
          directories: [
            { directory: 'Music/Album', files: [file('one')] },
            { directory: 'Music/Other', files: [file('two')] },
          ],
        },
      ],
    };
    await render(props);
    expandFirst();
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(1);
    expect(container.querySelector('[data-file-id="two"]')).toBeNull();
    expandFirst();
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
    expandFirst();
    await render({
      selectedUsername: 'other',
      transfers: [
        {
          username: 'other',
          directories: [
            {
              directory: 'Music/Album',
              files: [{ ...file('other'), username: 'other' }],
            },
          ],
        },
      ],
    });
    expect(
      container
        .querySelector('.ul-folder-toggle')
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
    expect(container.querySelector('.ul-complete').dataset.totalTracks).toBe(
      '1',
    );
    await render(props);
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
  });
  it('shows active tracks and their source above closed folders, isolated to the selected user', async () => {
    expect.hasAssertions();
    await render({
      transfers: [
        ...transfers([
          { ...file('sending', 'InProgress'), percentComplete: 42 },
          file('connecting', 'Initializing'),
          file('waiting'),
          file('finished', 'Completed, Succeeded'),
        ]),
        {
          username: 'other',
          directories: [
            {
              directory: 'Other/Private',
              files: [
                { ...file('other-active', 'InProgress'), username: 'other' },
              ],
            },
          ],
        },
      ],
    });
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-current-upload-id]')).toHaveLength(
      2,
    );
    const current = container.querySelector('.ul-current-uploads');
    expect(current.textContent).toContain('Track sending.flac');
    expect(current.textContent).toContain('From: Music/Album');
    expect(current.textContent).toContain('42%');
    expect(current.textContent).toContain('Connecting');
    expect(current.textContent).not.toContain('Track waiting.flac');
    expect(current.textContent).not.toContain('Track finished.flac');
    expect(current.textContent).not.toContain('Other/Private');
    expect(
      current.compareDocumentPosition(
        container.querySelector('.ul-complete-table'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await render({
      transfers: transfers([
        { ...file('sending', 'InProgress'), percentComplete: 71 },
      ]),
    });
    expect(
      container.querySelector('.ul-current-uploads').textContent,
    ).toContain('71%');
    await render({ transfers: transfers([file('waiting')]) });
    expect(container.querySelectorAll('[data-current-upload-id]')).toHaveLength(
      0,
    );
    expect(
      container.querySelector('.ul-current-uploads').textContent,
    ).toContain('Nothing uploading to this user right now.');
  });
  it('handles an empty recipient queue', async () => {
    expect.hasAssertions();
    await render({ queueUsers: [], selectedUsername: null });
    expect(container.textContent).toContain('No queued uploads.');
    expect(container.querySelector('[role="table"]')).toBeNull();
  });
});
