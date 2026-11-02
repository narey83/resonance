import { getStatus } from '../../lib/users';
import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../Shared', () => ({
  UsernameLink: ({ username }) => <span>{username}</span>,
}));
jest.mock('../../lib/users', () => ({
  getStatus: jest.fn().mockResolvedValue('Online'),
}));
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

describe('Uploads queue header placement', () => {
  let container;
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
  });

  it('places overall pagination below users with queue information under each user', async () => {
    expect.hasAssertions();
    const onPageChange = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <UploadsTable
          onPendingPageChange={onPageChange}
          totalPending={501}
          transfers={[
            {
              username: 'queue-user',
              directories: [
                {
                  directory: 'Music/Trance Classics',
                  files: [
                    {
                      id: 'queued-track',
                      filename: 'Music/Trance Classics/Example.flac',
                      direction: 'Upload',
                      state: 'Queued',
                      size: 1_024,
                    },
                  ],
                },
              ],
            },
          ]}
        />,
        container,
      );
    });
    const scrollArea = container.querySelector('.dl-groups');
    const rows = scrollArea.querySelectorAll('.dl-virtual-row');
    expect(rows[0].textContent).toBe('Uploading');
    expect(rows[1].textContent).toContain('queue-user');
    const user = rows[1].querySelector('.dl-user-group');
    const summary = user.querySelector('.ul-user-queue');
    expect(summary.textContent).toContain('1 queued track on this page');
    expect(user.querySelector('.dl-user-header').nextElementSibling).toBe(
      summary,
    );
    expect(rows[2].textContent).toContain(
      'All users — pending tracks: 1–250 of 501',
    );
    const folder = user.querySelector('.dl-dir-toggle');
    expect(folder.textContent).toContain('Show tracks');
    expect(user.querySelector('.dl-file-row')).toBeNull();
    act(() => {
      Simulate.click(folder);
    });
    expect(folder.getAttribute('aria-expanded')).toBe('true');
    expect(user.querySelector('.dl-file-row').textContent).toContain(
      'Example.flac',
    );
    expect(
      container.querySelector('.ul-queue-pagination').closest('.dl-groups'),
    ).toBe(scrollArea);
    Simulate.click(
      scrollArea.querySelector('[aria-label="Next pending uploads page"]'),
    );
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('keeps the empty queue state free of pagination', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <UploadsTable
          totalPending={0}
          transfers={[]}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('No uploads');
    expect(container.querySelector('.ul-queue-pagination')).toBeNull();
  });
});
