import { getStatus } from '../../lib/metadataLookup';
import MetadataLookupWatcher from './MetadataLookupWatcher';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { toast } from 'react-toastify';

jest.mock('../../lib/metadataLookup', () => ({ getStatus: jest.fn() }));
jest.mock('react-toastify', () => ({
  toast: { info: jest.fn(), success: jest.fn(), warn: jest.fn() },
}));
describe('Enrichment progress', () => {
  let container;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.useRealTimers();
  });
  it('shows live progress, reports completion once, and removes the badge', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValueOnce({
      scanning: true,
      progress: 0.5,
      total: 10,
      written: 3,
      skipped: 2,
      failed: 0,
    });
    await act(async () => {
      ReactDOM.render(<MetadataLookupWatcher />, container);
    });
    expect(container.textContent).toContain('Enrichment 50%');
    expect(container.textContent).toContain('5/10 tracks');
    getStatus.mockResolvedValue({
      scanning: false,
      completed: true,
      written: 8,
      skipped: 2,
      failed: 0,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it('does not start enrichment or show a busy badge when idle', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValue({ scanning: false, enabled: false });
    await act(async () => {
      ReactDOM.render(<MetadataLookupWatcher />, container);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
  });
  it('keeps index suspension quiet', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValue({
      scanning: true,
      paused: true,
      pauseReason: 'Waiting for share indexing',
      written: 5,
      skipped: 0,
      failed: 0,
      total: 10,
      progress: 0.5,
    });
    await act(async () => {
      ReactDOM.render(<MetadataLookupWatcher />, container);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('keeps empty discovery passes and their completion silent', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValue({ scanning: true, total: 0, inFlight: 0 });
    await act(async () => {
      ReactDOM.render(<MetadataLookupWatcher />, container);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    getStatus.mockResolvedValue({
      scanning: false,
      completed: true,
      written: 0,
      skipped: 0,
      failed: 0,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warn).not.toHaveBeenCalled();
  });

  it('waits for actual work and does not announce a resume twice', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValue({ scanning: true, total: 10, inFlight: 0 });
    await act(async () => {
      ReactDOM.render(<MetadataLookupWatcher />, container);
    });
    expect(toast.info).not.toHaveBeenCalled();
    getStatus.mockResolvedValue({
      scanning: true,
      total: 10,
      inFlight: 1,
      written: 0,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(container.textContent).toContain('Enrichment');
    expect(toast.info).toHaveBeenCalledTimes(1);
    getStatus.mockResolvedValue({
      scanning: true,
      paused: true,
      total: 10,
      inFlight: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
    getStatus.mockResolvedValue({
      scanning: true,
      total: 10,
      inFlight: 1,
      written: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(toast.info).toHaveBeenCalledTimes(1);
    getStatus.mockResolvedValue({
      scanning: false,
      completed: true,
      written: 0,
      failed: 0,
      skipped: 10,
    });
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
