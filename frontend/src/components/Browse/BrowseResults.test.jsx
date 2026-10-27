import { flattenDirectories } from '../../lib/browseFiles';
import * as transfers from '../../lib/transfers';
import BrowseResults from './BrowseResults';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ play: jest.fn() }),
}));
jest.mock('../../lib/transfers', () => ({ getAll: jest.fn() }));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }) => ({
    getTotalSize: () => count * 56,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: estimateSize(index),
        start: index * 56,
      })),
  }),
}));
jest.mock('../Shared/UsernameLink', () => ({ username }) => (
  <span>{username}</span>
));
jest.mock('../Search/Detail/FolderPickerModal', () => 'mock-folder-picker');

const files = flattenDirectories(
  [
    {
      name: 'Artist - Album',
      files: [{ filename: 'Track.flac', size: 1_000 }],
    },
  ],
  '\\',
);

describe('browse workspace', () => {
  let container;
  beforeEach(async () => {
    transfers.getAll.mockResolvedValue([]);
    container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      ReactDOM.render(
        <BrowseResults
          files={files}
          username="test-user"
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
  it('shows files immediately and can hide and restore them', () => {
    expect.hasAssertions();
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(1);
    expect(container.textContent).toContain('1 shown · 1 shared · 1 folder');
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Hide files',
        ),
      ),
    );
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(0);
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Show files',
        ),
      ),
    );
    expect(container.querySelectorAll('.sr-file-row')).toHaveLength(1);
  });
  it('keeps detailed filters tucked away until requested', () => {
    expect.hasAssertions();
    expect(container.querySelector('.sr-filters').hidden).toBe(true);
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === ' Refine',
        ),
      ),
    );
    expect(container.querySelector('.sr-filters').hidden).toBe(false);
  });
});
