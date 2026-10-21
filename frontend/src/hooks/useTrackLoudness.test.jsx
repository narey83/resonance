import api from '../lib/api';
import useTrackLoudness from './useTrackLoudness';
import React, { useLayoutEffect } from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../lib/api', () => ({ get: jest.fn() }));
jest.mock('../components/Shared/WaveformPreview', () => ({
  analyseTrack: jest.fn(),
}));

describe('loudness belongs to the active track', () => {
  let container;
  let readings;
  const Harness = ({ path }) => {
    const loudness = useTrackLoudness(path);
    useLayoutEffect(() => {
      readings.push({ path, value: loudness?.integratedLufs ?? null });
    });
    return <span>{loudness?.integratedLufs ?? 'unknown'}</span>;
  };

  const render = async (path) => {
    await act(async () => {
      ReactDOM.render(<Harness path={path} />, container);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    readings = [];
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('never paints the previous track’s LUFS while the next track is loading', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({ data: { integratedLufs: -6.7 } });
    let finishNext;
    api.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNext = resolve;
        }),
    );
    await render('/a');
    expect(container.textContent).toBe('-6.7');
    await render('/b');
    expect(
      readings
        .filter((row) => row.path === '/b')
        .every((row) => row.value === null),
    ).toBe(true);
    expect(container.textContent).toBe('unknown');
    await act(async () => finishNext({ data: { integratedLufs: -9.2 } }));
    expect(container.textContent).toBe('-9.2');
  });

  it('ignores a late response from a track that is no longer loaded', async () => {
    expect.hasAssertions();
    let finishOld;
    api.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    api.get.mockResolvedValueOnce({ data: { integratedLufs: -8.5 } });
    await render('/old');
    await render('/current');
    await act(async () => finishOld({ data: { integratedLufs: -14 } }));
    expect(container.textContent).toBe('-8.5');
    await render(undefined);
    expect(container.textContent).toBe('unknown');
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
