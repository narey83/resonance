import api from '../../lib/api';
import * as mixtapes from '../../lib/mixtapes';
import ExportPage from './ExportPage';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));
jest.mock('../../lib/mixtapes', () => ({ create: jest.fn() }));
jest.mock('../TrackAnalysis/UsbExportPanel', () => (props) => (
  <>
    <div data-testid="export-panel">{JSON.stringify(props)}</div>
    <button
      onClick={() =>
        props.onJobChange({ status: 'completed', downloadAvailable: true })
      }
      type="button"
    >
      Simulate completed export
    </button>
  </>
));
jest.mock('../TrackAnalysis/UsbExportInspector', () => () => (
  <div>Saved inspection</div>
));
const sources = {
  playlists: [{ id: 'mix', name: 'My playlist', trackCount: 2 }],
  crates: [{ id: 'crate', name: 'My crate' }],
  folders: [{ path: 'Album', name: 'Album', trackCount: 2 }],
  savedLists: [
    {
      id: 'saved',
      playlistName: 'Previous set',
      trackCount: 2,
      missingCount: 0,
      missingTracks: [],
      profile: 'legacy',
      playerModel: 'cdj-3000',
    },
  ],
};
const selection = {
  selectionId: 'selection',
  source: {
    kind: 'playlist',
    id: 'mix',
    name: 'My playlist',
    resolvedAt: '2026-10-29T00:00:00Z',
  },
  paths: ['/music/two.flac', '/music/one.flac'],
  playlistName: 'My playlist',
  trackCount: 2,
};
describe('Export source choices', () => {
  let container;
  const button = (text) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text,
    );
  const chooseSource = (text) => {
    act(() => {
      Simulate.click(
        container.querySelector('[aria-label="Export source item"]'),
      );
    });
    act(() => {
      Simulate.click(
        [...container.querySelectorAll('[role="option"]')].find(
          (item) => item.textContent === text,
        ),
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockResolvedValue({ data: sources });
    api.post.mockResolvedValue({ data: selection });
    api.delete.mockResolvedValue({});
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
  });
  const mount = async () => {
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <ExportPage />
        </MemoryRouter>,
        container,
      );
    });
  };

  it('offers reusable lists without downloading or rendering all library tracks', async () => {
    expect.hasAssertions();
    await mount();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(5);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/analysis/usb-export/sources');
    expect(container.querySelector('[data-testid="export-panel"]')).toBeNull();
    expect(container.textContent).toContain('Quick folder export');
  });
  it('opens an accessible source list and selects with the keyboard', async () => {
    expect.hasAssertions();
    await mount();
    const trigger = container.querySelector(
      '[aria-label="Export source item"]',
    );
    act(() => Simulate.keyDown(trigger, { key: 'ArrowDown' }));
    const items = container.querySelectorAll('[role="option"]');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(items).toHaveLength(2);
    act(() => Simulate.keyDown(items[0], { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(items[1]);
    act(() => Simulate.keyDown(items[1], { key: 'Enter' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('My playlist · 2 tracks');
    expect(button('Review export selection').disabled).toBe(false);
    act(() => Simulate.click(trigger));
    act(() =>
      Simulate.keyDown(container.querySelector('[role="option"]'), {
        key: 'Escape',
      }),
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
  it('preserves the server-resolved playlist order and snapshot when reviewing', async () => {
    expect.hasAssertions();
    await mount();
    chooseSource('My playlist · 2 tracks');
    await act(async () => {
      Simulate.click(button('Review export selection'));
    });
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export/resolve', {
      kind: 'playlist',
      id: 'mix',
    });
    const props = JSON.parse(
      container.querySelector('[data-testid="export-panel"]').textContent,
    );
    expect(props.initialPaths).toEqual(selection.paths);
    expect(props.selectionId).toBe('selection');
    expect(props.initialPlaylistName).toBe('My playlist');
  });
  it('reuses a saved list with its original player choice', async () => {
    expect.hasAssertions();
    api.post.mockResolvedValue({
      data: { ...selection, profile: 'legacy', playerModel: 'cdj-3000' },
    });
    await mount();
    act(() =>
      Simulate.change(container.querySelector('input[value="saved-list"]')),
    );
    chooseSource('Previous set · 2 tracks');
    await act(async () => Simulate.click(button('Review export selection')));
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export/resolve', {
      kind: 'saved-list',
      id: 'saved',
    });
    const props = JSON.parse(
      container.querySelector('[data-testid="export-panel"]').textContent,
    );
    expect(props.initialPaths).toEqual(selection.paths);
    expect(props.initialPlayerChoice).toBe('cdj-3000');
  });
  it('shows missing tracks and prevents a stale list from being reviewed', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        ...sources,
        savedLists: [
          {
            ...sources.savedLists[0],
            missingCount: 1,
            missingTracks: ['album/gone.flac'],
          },
        ],
      },
    });
    await mount();
    act(() =>
      Simulate.change(container.querySelector('input[value="saved-list"]')),
    );
    chooseSource('Previous set · 2 tracks · 1 missing');
    expect(container.textContent).toContain('album/gone.flac');
    expect(button('Review export selection').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('deletes a reusable list without cancelling its original export', async () => {
    expect.hasAssertions();
    await mount();
    act(() =>
      Simulate.change(container.querySelector('input[value="saved-list"]')),
    );
    chooseSource('Previous set · 2 tracks');
    await act(async () => Simulate.click(button('Delete saved list')));
    expect(api.delete).toHaveBeenCalledWith(
      '/analysis/usb-export/saved-lists/saved',
    );
  });
  it('moves the finished export ahead of the source chooser', async () => {
    expect.hasAssertions();
    await mount();
    chooseSource('My playlist · 2 tracks');
    await act(async () => Simulate.click(button('Review export selection')));
    await act(async () => Simulate.click(button('Simulate completed export')));
    expect(container.querySelector('.export-source').hidden).toBe(true);
    expect(container.querySelector('.export-source-context').hidden).toBe(true);
    expect(
      container.querySelector('[data-testid="export-panel"]'),
    ).not.toBeNull();
  });
  it.each([
    {
      kind: 'smart-crate',
      label: 'My crate',
      request: { kind: 'smart-crate', id: 'crate' },
    },
    {
      kind: 'folder',
      label: 'Album',
      request: { kind: 'folder', folder: 'Album' },
    },
  ])(
    'resolves $kind using its distinct source contract',
    async ({ kind, label, request }) => {
      expect.hasAssertions();
      await mount();
      act(() => {
        Simulate.change(container.querySelector(`input[value="${kind}"]`));
      });
      chooseSource(label);
      await act(async () => {
        Simulate.click(button('Review export selection'));
      });
      expect(api.post).toHaveBeenLastCalledWith(
        '/analysis/usb-export/resolve',
        request,
      );
    },
  );
  it('requires an explicit name to create a playlist and starts no export', async () => {
    expect.hasAssertions();
    await mount();
    act(() => {
      Simulate.change(container.querySelector('input[value="create"]'));
    });
    expect(button('Create playlist and add tracks').disabled).toBe(true);
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="New playlist name"]'),
        { target: { value: 'New set' } },
      );
    });
    mixtapes.create.mockResolvedValue({ id: 'new' });
    await act(async () => {
      Simulate.click(button('Create playlist and add tracks'));
    });
    expect(mixtapes.create).toHaveBeenCalledWith({ name: 'New set' });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('shows source resolution errors without an export panel', async () => {
    expect.hasAssertions();
    await mount();
    api.post.mockRejectedValue({ response: { data: 'No matching tracks' } });
    chooseSource('My playlist · 2 tracks');
    await act(async () => {
      Simulate.click(button('Review export selection'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'No matching tracks',
    );
    expect(container.querySelector('[data-testid="export-panel"]')).toBeNull();
  });
});
