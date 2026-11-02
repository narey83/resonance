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
describe('Upload queue views', () => {
  let container;
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <UploadsTable
          totalPending={501}
          transfers={[]}
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
  it('separates sending, waiting and finished tracks from the same folder', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers([
        file('sending', 'InProgress'),
        file('waiting', 'Queued'),
        file('sent', 'Completed, Succeeded'),
        file('failed', 'Completed, Errored'),
      ]),
    });
    const groups = container.querySelectorAll('.dl-user-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain('sending.flac');
    expect(groups[0].textContent).not.toContain('waiting.flac');
    expect(groups[1].textContent).toContain('waiting.flac');
    expect(groups[1].textContent).not.toContain('sent.flac');
    expect(groups[1].textContent).not.toContain('0 of');
    expect(groups[1].querySelector('.mini-progress')).toBeNull();
    act(() => Simulate.click(container.querySelectorAll('[role="tab"]')[1]));
    expect(container.textContent).toContain('Recent history');
    expect(container.textContent).not.toContain('Waiting to upload');
    act(() => Simulate.click(container.querySelector('.dl-user-toggle')));
    expect(container.textContent).toContain('sent.flac');
    expect(container.textContent).toContain('failed.flac');
    expect(container.textContent).not.toContain('sending.flac');
  });
  it('shows waiting track names immediately and reveals more in bounded batches', async () => {
    expect.hasAssertions();
    await render({
      transfers: transfers(
        Array.from({ length: 45 }, (_, i) => file(`track${i}`, 'Queued')),
      ),
    });
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(20);
    expect(container.textContent).toContain('45 waiting');
    act(() => Simulate.click(container.querySelector('.dl-show-more-btn')));
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(40);
    act(() => Simulate.click(container.querySelector('.dl-dir-toggle')));
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(0);
    act(() => Simulate.click(container.querySelector('.dl-dir-toggle')));
    expect(container.querySelectorAll('.dl-file-row')).toHaveLength(40);
  });
  it('keeps queue navigation separate from history page size', async () => {
    expect.hasAssertions();
    const onPendingPageChange = jest.fn();
    await render({ onPendingPageChange });
    expect(container.textContent).toContain('Queue page 1 of 3');
    expect(container.querySelector('select')).toBeNull();
    act(() =>
      Simulate.click(
        container.querySelector('[aria-label="Next pending uploads page"]'),
      ),
    );
    expect(onPendingPageChange).toHaveBeenCalledWith(1);
    act(() => Simulate.click(container.querySelectorAll('[role="tab"]')[1]));
    expect(container.textContent).toContain('People per history page');
    expect(
      container.querySelector('[aria-label="Pending uploads pages"]'),
    ).toBeNull();
  });
  it('cancels only unfinished requests on the displayed page after confirmation', async () => {
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
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('other pages will stay queued'),
    );
  });
  it('moves tracks between queue sections and history when polling updates their state', async () => {
    expect.hasAssertions();
    await render({ transfers: transfers([file('changing', 'Queued')]) });
    expect(
      container.querySelector('.ul-tracks--waiting').textContent,
    ).toContain('changing.flac');
    await render({ transfers: transfers([file('changing', 'InProgress')]) });
    expect(container.querySelector('.ul-tracks--waiting')).toBeNull();
    expect(
      container.querySelector('.ul-tracks--sending').textContent,
    ).toContain('changing.flac');
    await render({
      totalPending: 0,
      transfers: transfers([file('changing', 'Completed, Succeeded')]),
    });
    expect(container.querySelector('.ul-tracks--sending')).toBeNull();
    act(() => Simulate.click(container.querySelectorAll('[role="tab"]')[1]));
    expect(container.querySelector('.ul-person-summary').textContent).toContain(
      '1 finished',
    );
  });
  it('supports keyboard switching between queue and history', async () => {
    expect.hasAssertions();
    await render();
    const tabs = container.querySelector('[role="tablist"]');
    act(() => Simulate.keyDown(tabs, { key: 'ArrowRight' }));
    expect(
      container.querySelector('#ul-history-tab').getAttribute('aria-selected'),
    ).toBe('true');
    expect(document.activeElement.id).toBe('ul-history-tab');
    act(() => Simulate.keyDown(tabs, { key: 'Home' }));
    expect(
      container.querySelector('#ul-queue-tab').getAttribute('aria-selected'),
    ).toBe('true');
  });
  it('shows empty queue messages without reporting sent progress', async () => {
    expect.hasAssertions();
    await render({ totalPending: 0 });
    expect(container.textContent).toContain('No tracks left to send');
    expect(container.textContent).toContain('No waiting tracks on this page.');
    expect(
      container.querySelector('[aria-label="Next pending uploads page"]')
        .disabled,
    ).toBe(true);
  });
});
