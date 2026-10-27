import { usePlayer } from '../../context/PlayerContext';
import { resolveLibraryTracks } from '../../lib/libraryWorkbench';
import * as mixtapes from '../../lib/mixtapes';
import { MixtapesView } from './Library';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { toast } from 'react-toastify';

jest.mock('../../context/PlayerContext', () => ({ usePlayer: jest.fn() }));
jest.mock('../../lib/libraryWorkbench', () => ({
  ...jest.requireActual('../../lib/libraryWorkbench'),
  resolveLibraryTracks: jest.fn(),
}));
jest.mock('../../lib/mixtapes', () => ({ remove: jest.fn() }));
jest.mock('../../lib/prepareMixAudio', () => ({ renderMixDeck: jest.fn() }));
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const button = (name) =>
  [...document.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === name,
  );

describe('deleting from playlist detail', () => {
  let container;
  let onUpdate;
  let onSelectId;
  const mixtape = { id: 'detail-id', name: 'My set', tracks: [] };

  beforeEach(async () => {
    jest.clearAllMocks();
    usePlayer.mockReturnValue({ playQueue: jest.fn() });
    resolveLibraryTracks.mockResolvedValue([]);
    mixtapes.remove.mockResolvedValue({});
    onUpdate = jest.fn().mockResolvedValue();
    onSelectId = jest.fn();
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      ReactDOM.render(
        <MixtapesView
          onSelectId={onSelectId}
          onUpdate={onUpdate}
          playlists={[mixtape]}
          selectedId={mixtape.id}
          viewMode="grid"
        />,
        container,
      );
    });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('removes the confirmation on Cancel and Escape without leaving orphaned dialogs', () => {
    expect.hasAssertions();
    act(() => Simulate.click(button('Delete playlist')));
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    act(() => Simulate.click(button('Cancel')));
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
    expect(container.querySelector('.jb-mx-title-btn').textContent).toBe(
      'My set',
    );
    act(() => Simulate.click(button('Delete playlist')));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
    expect(mixtapes.remove).not.toHaveBeenCalled();
    expect(onSelectId).not.toHaveBeenCalled();
  });

  it('closes the confirmed deletion, returns to the collection and refreshes it', async () => {
    expect.hasAssertions();
    act(() => Simulate.click(button('Delete playlist')));
    const confirm = document.querySelector(
      '[role="alertdialog"] button:last-child',
    );
    await act(async () => Simulate.click(confirm));
    expect(mixtapes.remove).toHaveBeenCalledWith('detail-id');
    expect(onSelectId).toHaveBeenCalledWith(null);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      'Playlist deleted. Your music files are unchanged.',
    );
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
  });
});
