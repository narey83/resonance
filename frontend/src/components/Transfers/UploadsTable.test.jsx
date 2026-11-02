import { getStatus } from '../../lib/users';
import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../Shared', () => ({
  UsernameLink: ({ username }) => <span>{username}</span>,
}));
jest.mock('../../lib/users', () => ({ getStatus: jest.fn() }));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: index * 100,
      })),
    measureElement: () => {},
  }),
}));
const file = (id, state) => ({
  id,
  state,
  direction: 'Upload',
  username: 'listener',
  filename: `Music/Album/${id}.flac`,
  size: 1_024,
});
const transfers = (files) => [
  { username: 'listener', directories: [{ directory: 'Music/Album', files }] },
];
const users = [
  {
    username: 'listener',
    waitingCount: 249,
    activeCount: 1,
    pendingCount: 250,
  },
  {
    username: 'large-queue',
    waitingCount: 12_894,
    activeCount: 0,
    pendingCount: 12_894,
  },
];
describe('Complete upload recipient counts', () => {
  let container;
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <UploadsTable
          queueUsers={users}
          selectedUsername="listener"
          transfers={[]}
          userTotalPending={250}
          {...props}
        />,
        container,
      );
    });
  };

  beforeEach(() => {
    getStatus.mockResolvedValue({ data: { presence: 'Online' } });
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });
  it('reconciles the visible recipient waiting counts with the upload total', async () => {
    expect.hasAssertions();
    const onSelectUploadUser = jest.fn();
    await render({
      onSelectUploadUser,
      transfers: transfers([
        file('now', 'InProgress'),
        file('waiting', 'Queued'),
      ]),
    });
    expect(container.querySelector('.ul-queue-total strong').textContent).toBe(
      '13,143',
    );
    const counts = [...container.querySelectorAll('.ul-person-choice b')].map(
      (node) => Number(node.textContent.replaceAll(',', '')),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(13_143);
    expect(container.querySelector('.ul-people').textContent).toContain(
      'large-queue',
    );
    expect(container.querySelector('.ul-person-summary').textContent).toContain(
      '1 uploading or connecting',
    );
    expect(
      container.querySelectorAll('.ul-person-summary')[1].textContent,
    ).toContain('249 waiting in total');
    act(() =>
      Simulate.click(container.querySelectorAll('.ul-person-choice')[1]),
    );
    expect(onSelectUploadUser).toHaveBeenCalledWith('large-queue');
  });
  it('has no History tab or mixed completed records', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers([
        file('now', 'InProgress'),
        file('waiting', 'Queued'),
        file('sent', 'Completed, Succeeded'),
      ]),
    });
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.textContent).not.toContain('History');
    expect(container.textContent).not.toContain('sent.flac');
    expect(
      container.querySelector('.ul-tracks--sending').textContent,
    ).toContain('now.flac');
    expect(
      container.querySelector('.ul-tracks--waiting').textContent,
    ).toContain('waiting.flac');
    expect(
      container.querySelector('.ul-tracks--waiting .mini-progress'),
    ).toBeNull();
  });
  it('pages only the selected recipient while retaining all recipient counts', async () => {
    expect.hasAssertions();
    const onPendingPageChange = jest.fn();
    await render({
      selectedUsername: 'large-queue',
      userTotalPending: 12_894,
      onPendingPageChange,
    });
    expect(container.querySelector('.ul-view-footer').textContent).toContain(
      'large-queue · Queue page 1 of 52',
    );
    act(() =>
      Simulate.click(
        container.querySelector('[aria-label="Next pending uploads page"]'),
      ),
    );
    expect(onPendingPageChange).toHaveBeenCalledWith(1);
    expect(container.querySelector('.ul-queue-total strong').textContent).toBe(
      '13,143',
    );
  });
  it('shows tracks immediately and expands them in bounded batches', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers(
        Array.from({ length: 45 }, (_, i) => file(`track${i}`, 'Queued')),
      ),
    });
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(20);
    act(() => Simulate.click(container.querySelector('.dl-show-more-btn')));
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(40);
  });
  it('cancels only displayed-page unfinished requests after confirmation', async () => {
    expect.hasAssertions();
    const onCancel = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const queued = file('cancel-me', 'Queued');
    await render({
      onCancel,
      transfers: transfers([
        queued,
        file('keep-history', 'Completed, Succeeded'),
      ]),
    });
    act(() => Simulate.click(container.querySelector('.ul-quick-btn--cancel')));
    expect(onCancel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    act(() => Simulate.click(container.querySelector('.ul-quick-btn--cancel')));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith({ file: queued });
  });
  it('shows an empty queue with zero reconciled counts', async () => {
    expect.hasAssertions();
    await render({
      queueUsers: [],
      selectedUsername: null,
      userTotalPending: 0,
    });
    expect(container.querySelector('.ul-queue-total strong').textContent).toBe(
      '0',
    );
    expect(container.textContent).toContain('No queued uploads.');
    expect(
      container.querySelector('[aria-label="Next pending uploads page"]')
        .disabled,
    ).toBe(true);
  });
});
