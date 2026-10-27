import { getCurrent } from '../../lib/options';
import * as ytdlp from '../../lib/ytdlp';
import SearchPane from './SearchPane';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/options', () => ({ getCurrent: jest.fn() }));
jest.mock('../../lib/ytdlp', () => ({
  ...jest.requireActual('../../lib/ytdlp'),
  search: jest.fn(),
  resolveUrl: jest.fn(),
}));

const video = {
  videoId: 'test',
  type: 'video',
  title: 'A test set',
  duration: 3_600,
  uploader: 'Test artist',
};

describe('YouTube search wizard', () => {
  let container;
  let onDownload;
  beforeEach(async () => {
    localStorage.clear();
    getCurrent.mockResolvedValue({
      integrations: { yt_dlp: { audio_format: 'mp3' } },
    });
    ytdlp.search.mockResolvedValue({ data: [video] });
    ytdlp.resolveUrl.mockResolvedValue({ data: video });
    onDownload = jest.fn().mockResolvedValue();
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      ReactDOM.render(<SearchPane onDownload={onDownload} />, container);
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const query = (value) =>
    act(() =>
      Simulate.change(container.querySelector('input'), { target: { value } }),
    );
  const submit = () =>
    act(async () => {
      Simulate.submit(container.querySelector('form'));
    });
  const choose = (label, value) =>
    act(() =>
      Simulate.change(
        [...container.querySelectorAll('label')]
          .find((node) => node.textContent.startsWith(label))
          .querySelector('select'),
        { target: { value } },
      ),
    );
  it('waits for review, closes the wizard while searching and forwards only network options', async () => {
    expect.hasAssertions();
    expect(
      [...container.querySelectorAll('button')].some((button) =>
        button.textContent.includes('New search'),
      ),
    ).toBe(false);
    let finish;
    ytdlp.search.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    query('artist live set');
    await submit();
    choose('Length preference', 'set');
    choose('Audio format', 'flac');
    choose('Results to collect', '10');
    await submit();
    expect(ytdlp.search).not.toHaveBeenCalled();
    await submit();
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Searching YouTube');
    expect(ytdlp.search).toHaveBeenCalledWith('artist live set', {
      limit: 10,
      sort: '',
      type: 'video',
      uploadDate: '',
    });
    await act(async () => {
      finish({ data: [video] });
    });
    expect(container.textContent).toContain('A test set');
    expect(
      [...container.querySelectorAll('button')].some((button) =>
        button.textContent.includes('New search'),
      ),
    ).toBe(true);
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Download',
        ),
      );
    });
    expect(onDownload).toHaveBeenCalledWith(video, {
      minTrackDurationSeconds: 1_800,
      maxTrackDurationSeconds: 0,
      audioFormat: 'flac',
    });
  });
  it('resolves a direct video URL and does not apply a hidden duration cutoff to its download', async () => {
    expect.hasAssertions();
    query('https://www.youtube.com/watch?v=test');
    await submit();
    choose('Length preference', 'radio');
    await submit();
    await submit();
    expect(ytdlp.search).not.toHaveBeenCalled();
    expect(ytdlp.resolveUrl).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=test',
    );
    expect(container.textContent).toContain('A test set');
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Download',
        ),
      );
    });
    expect(onDownload).toHaveBeenCalledWith(video, { audioFormat: 'mp3' });
  });
  it('shows a useful failure and lets the user return to review and retry', async () => {
    expect.hasAssertions();
    ytdlp.search.mockRejectedValue(new Error('Service unavailable'));
    query('artist');
    await submit();
    await submit();
    await submit();
    expect(container.querySelector('[role=alert]').textContent).toContain(
      'Service unavailable',
    );
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Review and retry',
        ),
      );
    });
    expect(container.textContent).toContain('Ready to discover?');
    expect(container.querySelector('form')).not.toBeNull();
  });
  it('keeps channel date preferences out of the search and applies them only to collection downloads', async () => {
    expect.hasAssertions();
    const channel = {
      videoId: 'channel',
      type: 'channel',
      title: 'Test channel',
      uploader: 'Test channel',
    };
    ytdlp.search.mockResolvedValue({ data: [channel] });
    query('test channel');
    choose('Look for', 'channel');
    await submit();
    choose('Collection uploads', 'week');
    await submit();
    await submit();
    expect(ytdlp.search).toHaveBeenCalledWith('test channel', {
      limit: 25,
      sort: '',
      type: 'channel',
      uploadDate: '',
    });
    expect(onDownload).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Download all',
        ),
      );
    });
    expect(onDownload).toHaveBeenCalledWith(channel, {
      audioFormat: 'mp3',
      uploadedAfter: 'week',
    });
  });
  it('restores the executed query when backing out of a new search draft', async () => {
    expect.hasAssertions();
    query('original artist');
    await submit();
    await submit();
    await submit();
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find((button) =>
          button.textContent.includes('New search'),
        ),
      );
    });
    query('different artist');
    await act(async () => {
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Back to results',
        ),
      );
    });
    expect(
      container.querySelector('.sr-results-toolbar strong').textContent,
    ).toBe('original artist');
    expect(container.textContent).toContain('A test set');
    expect(ytdlp.search).toHaveBeenCalledTimes(1);
  });
});
