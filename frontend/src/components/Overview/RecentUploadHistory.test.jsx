import { getTransferHistory } from '../../lib/reports';
import RecentUploadHistory from './RecentUploadHistory';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/reports', () => ({ getTransferHistory: jest.fn() }));

const item = {
  id: 'upload-1',
  filename: 'Music/Album/Track.flac',
  username: 'listener',
  size: 1_024,
  stateDescription: 'Completed, TimedOut',
  endedAt: '2026-11-04T10:00:00Z',
};

describe('Overview recent upload history', () => {
  let container;
  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <RecentUploadHistory
            range={24}
            refreshKey={0}
            {...props}
          />
        </MemoryRouter>,
        container,
      );
    });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    getTransferHistory.mockResolvedValue({ items: [item] });
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  it('requests a bounded upload preview for the selected period and links to history', async () => {
    expect.hasAssertions();
    await render();
    const request = getTransferHistory.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({ direction: 'Upload', limit: 8 }),
    );
    expect(new Date(request.end) - new Date(request.start)).toBe(86_400_000);
    expect(container.textContent).toContain('Track.flac');
    expect(container.textContent).toContain('To listener');
    expect(container.textContent).toContain('Timed out');
    expect(container.querySelector('a').getAttribute('href')).toBe('/history');
  });
  it('retains rows on refresh failure and clears stale rows on a range change', async () => {
    expect.hasAssertions();
    await render();
    getTransferHistory.mockRejectedValue(new Error('Unavailable'));
    await render({ refreshKey: 1 });
    expect(container.textContent).toContain('Track.flac');
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'last loaded',
    );
    await render({ range: 168, refreshKey: 1 });
    expect(container.textContent).not.toContain('Track.flac');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('ignores late results after changing range and aborts on unmount', async () => {
    expect.hasAssertions();
    let finish;
    getTransferHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    const firstSignal = getTransferHistory.mock.calls[0][0].signal;
    getTransferHistory.mockResolvedValue({ items: [] });
    await render({ range: 168 });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => finish({ items: [item] }));
    expect(container.textContent).toContain('No finished uploads');
    expect(container.textContent).not.toContain('Track.flac');
    const lastSignal = getTransferHistory.mock.calls.at(-1)[0].signal;
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(lastSignal.aborted).toBe(true);
  });
});
