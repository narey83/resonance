import LoaderSegment from './LoaderSegment';
import LoadingState from './LoadingState';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const renderLoading = (element) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(element);
  return container;
};

describe('Branded loading states', () => {
  it('shows the logo with accessible loading text and a reduced-motion asset', () => {
    const container = renderLoading(<LoadingState />);
    const status = container.querySelector('[role="status"]');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Loading…');
    const mark = status.querySelector('img.resonance-mark');
    expect(mark.getAttribute('height')).toBe('48');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(status.querySelector('source').getAttribute('media')).toBe(
      '(prefers-reduced-motion: reduce)',
    );
  });

  it('preserves shared loader labels and modal styling', () => {
    const container = renderLoading(
      <LoaderSegment
        className="modal-loader"
        size="small"
      >
        Reading shared files…
      </LoaderSegment>,
    );
    const status = container.querySelector('[role="status"]');
    expect(status.classList.contains('modal-loader')).toBe(true);
    expect(status.textContent).toBe('Reading shared files…');
    expect(status.querySelector('img').getAttribute('height')).toBe('32');
  });
});
