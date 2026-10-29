import api from '../../lib/api';
import * as mixtapes from '../../lib/mixtapes';
import ExportPage from './ExportPage';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/api', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../lib/mixtapes', () => ({ create: jest.fn() }));
jest.mock('../TrackAnalysis/UsbExportPanel', () => (props) => (
  <div data-testid="export-panel">{JSON.stringify(props)}</div>
));
jest.mock('../TrackAnalysis/UsbExportInspector', () => () => (
  <div>Saved inspection</div>
));
const sources = {
  playlists: [{ id: 'mix', name: 'My playlist', trackCount: 2 }],
  crates: [{ id: 'crate', name: 'My crate' }],
  folders: [{ path: 'Album', name: 'Album', trackCount: 2 }],
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
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockResolvedValue({ data: sources });
    api.post.mockResolvedValue({ data: selection });
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

  it('offers all four paths without downloading or rendering all library tracks', async () => {
    expect.hasAssertions();
    await mount();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/analysis/usb-export/sources');
    expect(container.querySelector('[data-testid="export-panel"]')).toBeNull();
    expect(container.textContent).toContain('Quick folder export');
  });
  it('preserves the server-resolved playlist order and snapshot when reviewing', async () => {
    expect.hasAssertions();
    await mount();
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: 'mix' },
      });
    });
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
  it.each([
    {
      kind: 'smart-crate',
      id: 'crate',
      request: { kind: 'smart-crate', id: 'crate' },
    },
    {
      kind: 'folder',
      id: 'Album',
      request: { kind: 'folder', folder: 'Album' },
    },
  ])(
    'resolves $kind using its distinct source contract',
    async ({ id, kind, request }) => {
      expect.hasAssertions();
      await mount();
      act(() => {
        Simulate.change(container.querySelector(`input[value="${kind}"]`));
      });
      act(() => {
        Simulate.change(container.querySelector('select'), {
          target: { value: id },
        });
      });
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
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: 'mix' },
      });
    });
    await act(async () => {
      Simulate.click(button('Review export selection'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'No matching tracks',
    );
    expect(container.querySelector('[data-testid="export-panel"]')).toBeNull();
  });
});
