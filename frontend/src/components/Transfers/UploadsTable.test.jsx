import UploadsTable from './UploadsTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../Shared', () => ({ UsernameLink: () => null }));
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

describe('Uploads queue header placement', () => {
  let container;
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

  it('places pending pagination in the scrolling uploading section', () => {
    expect.hasAssertions();
    const onPageChange = jest.fn();
    act(() => {
      ReactDOM.render(
        <UploadsTable
          onPendingPageChange={onPageChange}
          totalPending={501}
          transfers={[]}
        />,
        container,
      );
    });
    const scrollArea = container.querySelector('.dl-groups');
    const rows = scrollArea.querySelectorAll('.dl-virtual-row');
    expect(rows[0].textContent).toBe('Uploading');
    expect(rows[1].textContent).toContain('Pending uploads: 1–250 of 501');
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
