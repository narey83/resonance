import * as api from '../../../lib/mixtapes';
import { addTracksToMixtape, MixtapeDropTarget } from './PlaylistTools';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/mixtapes', () => ({ addTrack: jest.fn() }));
describe('selected tracks to mixtape', () => {
  beforeEach(() => jest.resetAllMocks());
  it('deduplicates paths and tolerates already-present tracks', async () => {
    expect.hasAssertions();
    api.addTrack
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { status: 409 } });
    await expect(addTracksToMixtape('set', ['a', 'a', 'b'])).resolves.toEqual({
      added: 1,
      duplicates: 1,
    });
    expect(api.addTrack.mock.calls).toEqual([
      ['set', 'a'],
      ['set', 'b'],
    ]);
  });
  it('reports partial failure instead of pretending the whole batch succeeded', async () => {
    expect.hasAssertions();
    api.addTrack
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { status: 500 } });
    await expect(addTracksToMixtape('set', ['a', 'b', 'c'])).rejects.toThrow(
      '1 added before the request failed',
    );
    expect(api.addTrack).toHaveBeenCalledTimes(2);
  });
});

describe('mixtape drop target', () => {
  it('adds the dragged library path to the destination mixtape', async () => {
    expect.hasAssertions();
    api.addTrack.mockReset().mockResolvedValue({});
    const container = document.createElement('div');
    const onUpdate = jest.fn();
    act(() => {
      ReactDOM.render(
        <MixtapeDropTarget
          mixtape={{ id: 'destination', name: 'Set' }}
          onUpdate={onUpdate}
        >
          <span>Set</span>
        </MixtapeDropTarget>,
        container,
      );
    });
    await act(async () => {
      Simulate.drop(container.firstChild, {
        dataTransfer: {
          getData: () => JSON.stringify({ path: '/music/song.mp3' }),
        },
      });
    });
    expect(api.addTrack).toHaveBeenCalledWith('destination', '/music/song.mp3');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
});
