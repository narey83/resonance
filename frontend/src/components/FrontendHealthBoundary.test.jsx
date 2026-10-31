import FrontendHealthBoundary, {
  reportFrontendReady,
} from './FrontendHealthBoundary';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

const Broken = () => {
  throw new Error('Synthetic render failure');
};

describe('frontend render health', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    delete document.documentElement.dataset.resonanceFrontend;
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    delete document.documentElement.dataset.resonanceFrontend;
    jest.restoreAllMocks();
  });

  it('requires an explicit initialized render before reporting ready', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <FrontendHealthBoundary>
          <p>Starting</p>
        </FrontendHealthBoundary>,
        container,
      );
    });
    expect(document.documentElement.dataset.resonanceFrontend).toBeUndefined();
    reportFrontendReady();
    expect(document.documentElement.dataset.resonanceFrontend).toBe('ready');
  });

  it('replaces a crashed workspace and never keeps a stale ready signal', () => {
    expect.hasAssertions();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('resonance-token', 'synthetic-session');
    reportFrontendReady();
    act(() => {
      ReactDOM.render(
        <FrontendHealthBoundary>
          <Broken />
        </FrontendHealthBoundary>,
        container,
      );
    });
    expect(document.documentElement.dataset.resonanceFrontend).toBe('failed');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Reload',
    );
    expect(container.querySelector('button').textContent).toBe(
      'Reload Resonance',
    );
    expect(localStorage.getItem('resonance-token')).toBe('synthetic-session');
    reportFrontendReady();
    expect(document.documentElement.dataset.resonanceFrontend).toBe('failed');
    localStorage.removeItem('resonance-token');
  });
});
