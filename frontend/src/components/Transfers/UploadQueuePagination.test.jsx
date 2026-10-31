import UploadQueuePagination from './UploadQueuePagination';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('Pending uploads pagination', () => {
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
  const render = (page, total, onPageChange = jest.fn()) => {
    act(() => {
      ReactDOM.render(
        <UploadQueuePagination
          onPageChange={onPageChange}
          page={page}
          total={total}
        />,
        container,
      );
    });
  };

  it('shows the full pending count and requests the next page', () => {
    expect.hasAssertions();
    const next = jest.fn();
    render(0, 35_013, next);
    expect(container.textContent).toContain('1–250 of 35,013');
    expect(container.querySelector('button').disabled).toBe(true);
    Simulate.click(
      container.querySelector('[aria-label="Next pending uploads page"]'),
    );
    expect(next).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('whole queue');
  });
  it('bounds the final page and supports going back', () => {
    expect.hasAssertions();
    const previous = jest.fn();
    render(2, 501, previous);
    expect(container.textContent).toContain('501–501 of 501');
    expect(
      container.querySelector('[aria-label="Next pending uploads page"]')
        .disabled,
    ).toBe(true);
    Simulate.click(container.querySelector('button'));
    expect(previous).toHaveBeenCalledWith(1);
  });
  it('shows an empty queue without a negative or phantom page', () => {
    expect.hasAssertions();
    render(0, 0);
    expect(container.textContent).toContain('0–0 of 0');
    expect(
      [...container.querySelectorAll('button')].every((b) => b.disabled),
    ).toBe(true);
  });
});
