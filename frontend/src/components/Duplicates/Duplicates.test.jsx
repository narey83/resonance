import { deleteTrackBatch } from '../../lib/musicLibrary';
import { browseAll, getTags } from '../../lib/shares';
import Duplicates from './Duplicates';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/musicLibrary', () => ({ deleteTrackBatch: jest.fn() }));
jest.mock('../../lib/shares', () => ({
  browseAll: jest.fn(),
  getTags: jest.fn(),
}));
jest.mock('../../lib/activityNotices', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warn: jest.fn() },
}));

const directory = (name, filename, size, bitRate) => ({
  name,
  files: [{ filename, extension: 'mp3', size, bitRate }],
});
const click = (button) => act(() => Simulate.click(button));
const buttons = (container, text) =>
  [...container.querySelectorAll('button')].filter((button) =>
    button.textContent.includes(text),
  );

// The destructive action is deliberately tested at the UI boundary.
describe('duplicate review', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    browseAll.mockResolvedValue([
      directory('share\\One', 'Artist - Song.mp3', 1_000, 320),
      directory('share\\Two', 'Artist - Song.mp3', 800, 192),
    ]);
    getTags.mockResolvedValue({});
    deleteTrackBatch.mockReset();
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  it('stages the other copy and requires a final review before deletion', async () => {
    expect.assertions(6);
    await act(async () => {
      ReactDOM.render(<Duplicates />, container);
    });
    expect(container.textContent).toContain('2 copies');
    click(buttons(container, 'Keep this')[0]);
    expect(container.textContent).toContain('1 selected for removal');
    expect(deleteTrackBatch).not.toHaveBeenCalled();
    click(buttons(container, 'Review removal')[0]);
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain('share\\Two\\Artist - Song.mp3');
    expect(deleteTrackBatch).not.toHaveBeenCalled();
    click(buttons(dialog, 'Cancel')[0]);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps one copy staged when the user tries to remove both', async () => {
    expect.assertions(2);
    await act(async () => {
      ReactDOM.render(<Duplicates />, container);
    });
    const checkboxes = container.querySelectorAll('.dupes-remove input');
    act(() => Simulate.change(checkboxes[0], { target: { checked: true } }));
    act(() => Simulate.change(checkboxes[1], { target: { checked: true } }));
    expect(container.textContent).toContain('1 selected for removal');
    expect(deleteTrackBatch).not.toHaveBeenCalled();
  });

  it('sends only the reviewed path when deletion is confirmed', async () => {
    expect.assertions(3);
    await act(async () => {
      ReactDOM.render(<Duplicates />, container);
    });
    click(buttons(container, 'Keep this')[0]);
    click(buttons(container, 'Review removal')[0]);
    deleteTrackBatch.mockResolvedValue({
      deleted: 1,
      forbidden: 0,
      notFound: 0,
    });
    browseAll.mockResolvedValueOnce([
      directory('share\\One', 'Artist - Song.mp3', 1_000, 320),
    ]);
    await act(async () => {
      Simulate.click(buttons(container, 'Delete selected files')[0]);
    });
    expect(deleteTrackBatch).toHaveBeenCalledTimes(1);
    expect(deleteTrackBatch).toHaveBeenCalledWith([
      'share\\Two\\Artist - Song.mp3',
    ]);
    expect(container.textContent).not.toContain('selected for removal');
  });

  it('does not suggest a large lossless file with unknown quality over a measured one', async () => {
    expect.assertions(2);
    browseAll.mockResolvedValue([
      {
        name: 'share\\Unknown',
        files: [
          {
            filename: 'Artist - Song.flac',
            extension: 'flac',
            size: 50_000_000,
          },
        ],
      },
      {
        name: 'share\\Measured',
        files: [
          {
            filename: 'Artist - Song.flac',
            extension: 'flac',
            size: 30_000_000,
            bitDepth: 16,
            sampleRate: 44_100,
          },
        ],
      },
    ]);
    await act(async () => {
      ReactDOM.render(<Duplicates />, container);
    });
    const rows = container.querySelectorAll('.dupes-file-row');
    expect(rows[0].textContent).toContain('30.0 MB');
    expect(rows[0].textContent).toContain('Suggested');
  });

  it('treats folder comparisons as inspection views', async () => {
    expect.assertions(2);
    await act(async () => {
      ReactDOM.render(<Duplicates />, container);
    });
    const select = container.querySelector('#dupes-mode');
    act(() => Simulate.change(select, { target: { value: 'folder' } }));
    expect(container.textContent).toContain('Folders with matches');
    expect(container.querySelector('.dupes-remove')).toBeNull();
  });
});
