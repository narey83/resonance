import api from '../../lib/api';
import StemPreview from './StemPreview';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn(), post: jest.fn() }));

describe('StemPreview', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockReset();
    api.post.mockReset();
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: jest.fn(() => 'blob:stem-preview'),
      },
      revokeObjectURL: { configurable: true, value: jest.fn() },
    });
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation();
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });

  const click = async (label) => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === label,
    );
    await act(async () => Simulate.click(button));
  };

  it('generates only a 30 second stem candidate and loads one stem on demand', async () => {
    expect.hasAssertions();
    const jobId = 'a'.repeat(32);
    const onGenerated = jest.fn();
    api.post.mockResolvedValue({ data: { job: { jobId } } });
    api.get
      .mockResolvedValueOnce({
        data: {
          contentCurrent: true,
          analysis: { featureAvailability: { stems: 'available' } },
        },
      })
      .mockResolvedValueOnce({ data: new Blob(['audio']) });
    await act(async () => {
      ReactDOM.render(
        <StemPreview
          enabled
          onGenerated={onGenerated}
          path="track.flac"
        />,
        container,
      );
    });

    await click('Generate stem preview');
    expect(api.post).toHaveBeenCalledWith(
      '/analysis/candidates',
      { path: 'track.flac', seconds: 30, features: ['stems'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);

    await click('Listen to vocals');
    expect(api.get).toHaveBeenLastCalledWith(
      `/analysis/candidates/${jobId}/stems/vocals`,
      expect.objectContaining({ responseType: 'blob' }),
    );
    expect(container.querySelector('audio').getAttribute('src')).toBe(
      'blob:stem-preview',
    );
    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('does not offer playback when stem analysis is unavailable', async () => {
    expect.hasAssertions();
    api.post.mockResolvedValue({ data: { job: { jobId: 'b'.repeat(32) } } });
    api.get.mockResolvedValue({
      data: {
        contentCurrent: true,
        analysis: { featureAvailability: { stems: 'failed' } },
      },
    });
    await act(async () => {
      ReactDOM.render(
        <StemPreview
          enabled
          path="track.flac"
        />,
        container,
      );
    });
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: 'full' },
      });
    });
    await click('Generate stem preview');
    expect(api.post).toHaveBeenCalledWith(
      '/analysis/candidates',
      { path: 'track.flac', seconds: null, features: ['stems'] },
      expect.any(Object),
    );
    expect(container.textContent).toContain('Stem separation did not finish');
    expect(container.textContent).not.toContain('Listen to vocals');
  });
});
