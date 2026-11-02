import usePreparationStatus from '../../../hooks/usePreparationStatus';
import { getScanState } from '../../../lib/analysis';
import { getAnalysisStats } from '../../../lib/musicLibrary';
import PreparationHomeCard from './PreparationHomeCard';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../../hooks/usePreparationStatus', () => jest.fn());
jest.mock('../../../lib/analysis', () => ({ getScanState: jest.fn() }));
jest.mock('../../../lib/musicLibrary', () => ({ getAnalysisStats: jest.fn() }));

describe('Library readiness card', () => {
  let container;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    usePreparationStatus.mockReturnValue({
      status: { paused: true, counts: { complete: 36, queued: 59_377 } },
    });
    getAnalysisStats.mockResolvedValue({
      total: 59_413,
      complete: 47_863,
      enhanced: { complete: 36 },
    });
    getScanState.mockResolvedValue({ scanning: true, inFlight: 8, failed: 3 });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  const render = async () =>
    act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <PreparationHomeCard />
        </MemoryRouter>,
        container,
      );
    });
  it('uses saved coverage while reporting a running scan separately from background scheduling', async () => {
    expect.hasAssertions();
    await render();
    expect(getAnalysisStats).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      '47,863 Basic ready · 36 Enhanced ready · 59,413 total tracks',
    );
    expect(container.textContent).toContain(
      'Basic scan · Running · 8 analysing · 3 failed',
    );
    expect(container.textContent).toContain('Background scheduling: Off');
    expect(container.querySelector('a').getAttribute('href')).toBe(
      '/trackanalysis',
    );
    expect(container.textContent).not.toContain('Preparation is paused');
  });
  it('retains last known counts and labels stale data when polling fails', async () => {
    expect.hasAssertions();
    await render();
    getAnalysisStats.mockRejectedValueOnce(new Error('offline'));
    getScanState.mockRejectedValueOnce(new Error('offline'));
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('47,863 Basic ready');
    expect(container.textContent).toContain('Readiness updates delayed');
    expect(container.textContent).toContain('Current scan status unavailable');
  });
  it('does not convert missing coverage or failed requests to zero', async () => {
    expect.hasAssertions();
    getAnalysisStats.mockRejectedValueOnce(new Error('offline'));
    getScanState.mockResolvedValueOnce({ scanning: false });
    await render();
    expect(container.textContent).toContain(
      '— Basic ready · — Enhanced ready · — total tracks',
    );
    expect(container.textContent).toContain('No manual scan running');
  });
  it('polls again and shows the scan pause and Enhanced mode accurately', async () => {
    expect.hasAssertions();
    await render();
    getScanState.mockResolvedValueOnce({
      scanning: true,
      paused: true,
      enhancedTotal: 10,
      failed: 0,
    });
    getAnalysisStats.mockResolvedValueOnce({
      total: 59_413,
      complete: 47_870,
      enhanced: { complete: 40 },
    });
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(container.textContent).toContain(
      '47,870 Basic ready · 40 Enhanced ready',
    );
    expect(container.textContent).toContain('Basic + Enhanced scan · Paused');
  });
});
