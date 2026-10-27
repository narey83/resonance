/* Browser payload mocks deliberately branch on track indexes and data types. */
/* eslint-disable jest/no-conditional-in-test */
import { useSetPlanner } from '../../../context/SetPlannerContext';
import useSetPlanAnalysis from '../../../hooks/useSetPlanAnalysis';
import {
  savedSet,
  setData,
  setTracks,
} from '../../../lib/__fixtures__/setPlannerData';
import { getCratePage, getCrates } from '../../../lib/libraryWorkspace';
import { getFolders, getTrackPage } from '../../../lib/musicLibrary';
import { setMixtape } from '../../../lib/setPlanner';
import { usePagedList } from '../../../lib/usePagedList';
import { useMixPreview } from './MixCompatibilityPreview';
import SetPlannerView from './SetPlannerView';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: 0 }),
}));
jest.mock('../../../context/SetPlannerContext', () => ({
  useSetPlanner: jest.fn(),
}));
jest.mock('../../../hooks/useSetPlanAnalysis', () => jest.fn());
jest.mock('../../../lib/libraryWorkspace', () => ({
  getCrates: jest.fn(),
  getCratePage: jest.fn(),
}));
jest.mock('../../../lib/musicLibrary', () => ({
  getFolders: jest.fn(),
  getTrackPage: jest.fn(),
}));
jest.mock('../../../lib/usePagedList', () => ({ usePagedList: jest.fn() }));
jest.mock('../../../lib/setPlanner', () => ({
  ...jest.requireActual('../../../lib/setPlanner'),
  setMixtape: jest.fn(),
}));
jest.mock('./MixCompatibilityPreview', () => ({ useMixPreview: jest.fn() }));
jest.mock('./AlbumArt', () => () => <span>Art</span>);
const button = (container, name) =>
  [...container.querySelectorAll('button')].find(
    (node) =>
      node.textContent.trim() === name ||
      node.getAttribute('aria-label') === name,
  );

describe('desktop Set Planner workflow', () => {
  let container;
  let planner;
  let preview;
  let onExport;
  let onMixtape;
  beforeEach(() => {
    jest.clearAllMocks();
    planner = {
      draft: savedSet,
      sets: [savedSet],
      loading: false,
      saving: false,
      dirty: false,
      activate: jest.fn(),
      edit: jest.fn(),
      flush: jest.fn(async () => ({ ...savedSet, revision: 2 })),
      copy: jest.fn(),
      retry: jest.fn(),
      reload: jest.fn(),
      create: jest.fn(),
      select: jest.fn(),
      archive: jest.fn(),
    };
    useSetPlanner.mockImplementation(() => planner);
    useSetPlanAnalysis.mockReturnValue(setData);
    preview = {
      open: jest.fn(),
      openSet: jest.fn(),
    };
    useMixPreview.mockReturnValue(preview);
    getCrates.mockResolvedValue([{ id: 'recent', name: 'Fresh arrivals' }]);
    getFolders.mockResolvedValue([{ path: '/library', name: 'Library' }]);
    usePagedList.mockReturnValue({
      items: setTracks.map((data) => data.track),
      total: 3,
      loading: false,
    });
    setMixtape.mockResolvedValue({ id: 'mixtape', name: 'Test set', count: 2 });
    onExport = jest.fn();
    onMixtape = jest.fn();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(
        <SetPlannerView
          onExport={onExport}
          onMixtape={onMixtape}
        />,
        container,
      );
    });
  };

  it('shows the desktop track browser, first-track master and running order without starting audio', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).toContain('Shape your next set');
    expect(
      container.querySelector('[aria-label="Set initial master source"]').value,
    ).toBe('first');
    expect(container.querySelectorAll('.set-order-item')).toHaveLength(2);
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(button(container, 'Add Opener to set').disabled).toBe(true);
    act(() => Simulate.click(button(container, 'Add Closer to set')));
    expect(
      planner.edit.mock.calls
        .at(-1)[0](savedSet)
        .items.map((item) => item.path),
    ).toEqual(setTracks.map(({ track }) => track.path));
  });
  it('loads smart-crate and folder sources with the existing paged API contract', async () => {
    expect.hasAssertions();
    await render();
    act(() =>
      Simulate.change(
        container.querySelector('[aria-label="Set track source"]'),
        { target: { value: 'recent' } },
      ),
    );
    const [crateFetch, crateQuery] = usePagedList.mock.calls.at(-1);
    await crateFetch({ ...crateQuery, limit: 50, offset: 0 });
    expect(getCratePage).toHaveBeenCalledWith(
      expect.objectContaining({
        crateId: 'recent',
        limit: 50,
        offset: 0,
        sort: 'title',
      }),
    );
    act(() =>
      Simulate.change(
        container.querySelector('[aria-label="Set track source"]'),
        { target: { value: '' } },
      ),
    );
    act(() =>
      Simulate.change(
        container.querySelector('[aria-label="Set track folder"]'),
        { target: { value: '/library' } },
      ),
    );
    const [folderFetch, folderQuery] = usePagedList.mock.calls.at(-1);
    await folderFetch({ ...folderQuery, limit: 50, offset: 0 });
    expect(getTrackPage).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: '/library',
        limit: 50,
        offset: 0,
        sort: 'title',
      }),
    );
  });
  it('shows both genre families and advice for mismatches between neighbours', async () => {
    expect.hasAssertions();
    useSetPlanAnalysis.mockReturnValue({
      ...setData,
      [setTracks[1].track.path]: {
        ...setTracks[1],
        track: { ...setTracks[1].track, genre: 'Hip-Hop' },
      },
    });
    await render();
    const notice = container.querySelector('.genre-warning.is-mismatch');
    expect(notice.getAttribute('aria-label')).toBe('Genre mismatch');
    expect(notice.textContent).toContain('House');
    expect(notice.textContent).toContain('Hip-hop / R&B');
    expect(notice.textContent).toContain('Tagged: Hip-Hop');
    expect(notice.textContent).toContain('short handover');
    expect(button(container, 'Preview handover 1 to 2').disabled).toBe(false);
  });
  it('reorders with buttons, keyboard and drag/drop without changing stored track BPM', async () => {
    expect.hasAssertions();
    await render();
    act(() => Simulate.click(button(container, 'Move Middle up')));
    expect(planner.edit.mock.calls.at(-1)[0](savedSet).items[0].path).toBe(
      setTracks[1].track.path,
    );
    act(() =>
      Simulate.keyDown(
        button(container, 'Drag Opener; Alt and arrow keys to reorder'),
        { altKey: true, key: 'ArrowDown' },
      ),
    );
    expect(planner.edit.mock.calls.at(-1)[0](savedSet).items[0].path).toBe(
      setTracks[1].track.path,
    );
    act(() =>
      Simulate.drop(container.querySelector('.set-order-item'), {
        dataTransfer: {
          getData: (type) =>
            type === 'application/resonance-set-item'
              ? JSON.stringify({
                  setId: savedSet.id,
                  path: setTracks[1].track.path,
                })
              : '',
        },
      }),
    );
    expect(planner.edit.mock.calls.at(-1)[0](savedSet).items[0].path).toBe(
      setTracks[1].track.path,
    );
    expect(setTracks[0].track.bpm).toBe(120);
    expect(setTracks[1].track.bpm).toBe(128);
  });
  it('passes the same set master into every transition preview and removes checkpoint controls', async () => {
    expect.hasAssertions();
    planner.draft = {
      ...savedSet,
      items: [
        ...savedSet.items.map((item, i) =>
          i === 1 ? { ...item, masterBpm: 126 } : item,
        ),
        { path: setTracks[2].track.path, masterBpm: null },
      ],
    };
    await render();
    act(() => Simulate.click(button(container, 'Preview handover 1 to 2')));
    expect(preview.open).toHaveBeenLastCalledWith(
      setTracks[0].track,
      setTracks[1].track,
      { masterBpm: 120, bars: 16, extendedTempo: false },
    );
    act(() => Simulate.click(button(container, 'Preview handover 2 to 3')));
    expect(preview.open).toHaveBeenLastCalledWith(
      setTracks[1].track,
      setTracks[2].track,
      { masterBpm: 120, bars: 16, extendedTempo: false },
    );
    expect(
      container.querySelector('[aria-label^="Tempo checkpoint"]'),
    ).toBeNull();
  });
  it('saves the current draft before opening the full-set rehearsal', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => Simulate.click(button(container, 'Rehearse set')));
    expect(planner.flush).toHaveBeenCalledWith(true);
    expect(preview.openSet).toHaveBeenCalledWith({ ...savedSet, revision: 2 });
  });
  it('creates a playlist only after saving, then lets the user open it', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      Simulate.click(button(container, 'Save as playlist')),
    );
    expect(planner.flush).toHaveBeenCalledWith(true);
    expect(setMixtape).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2 }),
      expect.stringMatching(/^[\da-f]{32}$/),
    );
    expect(container.textContent).toContain('2 tracks in set order');
    act(() => Simulate.click(button(container, 'Open “Test set” playlist')));
    expect(onMixtape).toHaveBeenCalledWith('mixtape');
  });
  it('hands the saved name and exact running order to USB export', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => Simulate.click(button(container, 'Export set')));
    expect(onExport).toHaveBeenCalledWith(
      savedSet.items.map((item) => item.path),
      'Test set',
    );
  });
  it('does not create a playlist or export when saving fails', async () => {
    expect.hasAssertions();
    planner.flush.mockRejectedValue(new Error('Connection lost; draft kept'));
    await render();
    await act(async () =>
      Simulate.click(button(container, 'Save as playlist')),
    );
    expect(setMixtape).not.toHaveBeenCalled();
    await act(async () => Simulate.click(button(container, 'Export set')));
    expect(onExport).not.toHaveBeenCalled();
    expect(container.textContent).toContain('draft kept');
  });
});
