import { getActivity, getStatus, runNow } from '../../lib/metadataLookup';
import MetadataLookup from './MetadataLookup';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/metadataLookup', () => ({
  getActivity: jest.fn(),
  getStatus: jest.fn(),
  runNow: jest.fn(),
  stopNow: jest.fn(),
}));
jest.mock('react-toastify', () => ({
  toast: { info: jest.fn(), error: jest.fn() },
}));

const event = (status, fields = {}) => ({
  id: status,
  at: '2026-10-30T12:00:00Z',
  origin: 'Automatic',
  status,
  fields,
  summary: 'Synthetic lookup evidence',
});
const page = {
  total: 3,
  updated: 1,
  notUpdated: 1,
  unknown: 1,
  page: 1,
  pageSize: 50,
  filtered: 3,
  historyHealthy: true,
  items: [
    {
      maskedFilename: 'one',
      filename: 'Updated track.mp3',
      directory: 'Album',
      status: 'NoMatch',
      lastUpdate: event('Updated', { Album: 'Discogs' }),
      history: [event('NoMatch'), event('Updated', { Album: 'Discogs' })],
    },
    {
      maskedFilename: 'two',
      filename: 'Preview track.mp3',
      directory: 'Album',
      status: 'Preview',
      history: [event('Preview')],
      lastUpdate: null,
    },
    {
      maskedFilename: 'three',
      filename: 'Legacy track.mp3',
      directory: 'Album',
      status: 'Unknown',
      history: [],
      lastUpdate: null,
    },
  ],
};

describe('Online lookup status and evidence', () => {
  let container;
  const button = (label) =>
    [...container.querySelectorAll('button')].find((element) =>
      element.textContent.includes(label),
    );
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<MetadataLookup />, container);
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    getStatus.mockResolvedValue({
      enabled: true,
      scanning: false,
      providers: ['Discogs', 'MusicBrainz'],
      recent: [],
    });
    getActivity.mockResolvedValue(page);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  it('distinguishes settings, confirmed updates, previews, and unverified earlier attempts', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).toContain('Automatic lookup enabled');
    expect(container.textContent).toContain('Discogs, MusicBrainz');
    const summaries = [...container.querySelectorAll('summary')];
    expect(summaries[0].textContent).toContain('Updated online');
    expect(summaries[0].textContent).toContain('No match');
    expect(summaries[1].textContent).toContain('Not saved');
    expect(summaries[1].textContent).not.toContain('Updated online');
    expect(summaries[2].textContent).toContain('unverified');
    expect(container.textContent).toContain('Album (Discogs)');
    expect(container.textContent).toContain(
      'Whether online metadata changed the file is unknown',
    );
    expect(runNow).not.toHaveBeenCalled();
  });
  it('shows unavailable settings instead of claiming lookup is disabled', async () => {
    expect.hasAssertions();
    getStatus.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.textContent).toContain('Status unavailable');
    expect(container.textContent).not.toContain('Automatic lookup disabled');
    expect(button('Run now').disabled).toBe(true);
  });
  it('filters and searches history without starting a lookup', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => {
      Simulate.click(button('Confirmed updated'));
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(getActivity).toHaveBeenLastCalledWith({
      outcome: 'updated',
      page: 1,
      search: '',
    });
    await act(async () => {
      Simulate.change(container.querySelector('input[type="search"]'), {
        target: { value: 'Track' },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(getActivity).toHaveBeenLastCalledWith({
      outcome: 'updated',
      page: 1,
      search: 'Track',
    });
    expect(runNow).not.toHaveBeenCalled();
  });
  it('keeps earlier history visible with an explicit refresh failure and supports retry', async () => {
    expect.hasAssertions();
    await render();
    getActivity.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      Simulate.click(button('Refresh activity'));
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(container.textContent).toContain('Activity could not be refreshed');
    expect(container.textContent).toContain('Updated track.mp3');
    await act(async () => {
      Simulate.click(button('Refresh activity'));
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(container.textContent).not.toContain(
      'Activity could not be refreshed',
    );
  });
  it('reports empty results and incomplete history', async () => {
    expect.hasAssertions();
    getActivity.mockResolvedValue({
      ...page,
      items: [],
      filtered: 0,
      historyHealthy: false,
    });
    await render();
    expect(container.textContent).toContain('No shared audio tracks yet');
    expect(container.textContent).toContain('record may be incomplete');
    expect(button('Next').disabled).toBe(true);
  });
  it('distinguishes disabled automatic lookup from enabled lookup with no providers', async () => {
    expect.hasAssertions();
    getStatus.mockResolvedValue({ enabled: false, providers: [], recent: [] });
    await render();
    expect(container.textContent).toContain('Automatic lookup disabled');
    expect(container.textContent).toContain('none configured');
    expect(button('Run now').disabled).toBe(true);
  });
});
