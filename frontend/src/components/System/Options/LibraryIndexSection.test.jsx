import {
  createIndexSnapshot,
  deleteAndRebuildIndex,
  getIndexSnapshots,
  getLibraryStats,
  getSyncState,
  restoreIndexSnapshot,
} from '../../../lib/musicLibrary';
import LibraryIndexSection from './LibraryIndexSection';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/musicLibrary', () => ({
  createIndexSnapshot: jest.fn(),
  deleteAndRebuildIndex: jest.fn(),
  getIndexSnapshots: jest.fn(),
  getLibraryStats: jest.fn(),
  getSyncState: jest.fn(),
  restoreIndexSnapshot: jest.fn(),
}));

describe('Library index settings', () => {
  let container;
  const button = (label) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent.trim() === label,
    );

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    getIndexSnapshots.mockResolvedValue([]);
    getLibraryStats.mockResolvedValue({ total: 2 });
    getSyncState.mockResolvedValue({ running: false });
    createIndexSnapshot.mockResolvedValue({ trackCount: 2 });
    deleteAndRebuildIndex.mockResolvedValue({ removed: 2 });
    restoreIndexSnapshot.mockResolvedValue({ trackCount: 2 });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
  });

  const render = async () => {
    await act(async () => {
      ReactDOM.render(<LibraryIndexSection />, container);
    });
  };

  it('requires the exact typed phrase before requesting deletion and rebuild', async () => {
    expect.assertions(4);
    await render();
    const deleteButton = button('Delete index and rebuild');
    expect(deleteButton.disabled).toBe(true);
    await act(async () => {
      Simulate.change(container.querySelector('input'), {
        target: { value: 'DELETE LIBRARY INDEX' },
      });
    });
    expect(deleteButton.disabled).toBe(false);
    await act(async () => Simulate.click(deleteButton));
    expect(deleteAndRebuildIndex).toHaveBeenCalledWith('DELETE LIBRARY INDEX');
    expect(container.textContent).toContain('Verified empty');
  });

  it('lists a server snapshot and restores only after confirmation', async () => {
    expect.assertions(2);
    getIndexSnapshots.mockResolvedValue([
      {
        id: 'snapshot-id',
        createdAtUtc: '2026-11-11T12:00:00Z',
        trackCount: 2,
      },
    ]);
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await render();
    await act(async () => Simulate.click(button('Restore')));
    expect(restoreIndexSnapshot).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => Simulate.click(button('Restore')));
    expect(restoreIndexSnapshot).toHaveBeenCalledWith('snapshot-id');
    confirm.mockRestore();
  });
});
