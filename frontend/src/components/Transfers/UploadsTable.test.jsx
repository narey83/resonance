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
  it('shows every track without pagination, show-more or repeated user headings', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers(
        Array.from({ length: 45 }, (_, i) => file(String(i))),
      ),
    });
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
      'Uploading now',
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
    expect(container.querySelectorAll('[data-file-id]')).toHaveLength(2);
    expect(
      container.querySelector('[data-file-id="active"]').textContent,
    ).toContain('25%');
    expect(container.textContent).not.toContain('Track old.flac');
  });
  it('handles an empty recipient queue', async () => {
    expect.hasAssertions();
    await render({ queueUsers: [], selectedUsername: null });
    expect(container.textContent).toContain('No queued uploads.');
    expect(container.querySelector('[role="table"]')).toBeNull();
  });
});
