import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import {
  getCratePage,
  getCrates,
  previewCrate,
  saveCrate,
} from '../../../lib/libraryWorkspace';
import SmartCratesView, { CrateEditor, CrateTracks } from './SmartCratesView';
import TrackTable from './TrackTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: jest.fn(),
}));
jest.mock('../../../lib/libraryWorkspace', () => ({
  ...jest.requireActual('../../../lib/libraryWorkspace'),
  getCrates: jest.fn(),
  getCratePage: jest.fn(),
  previewCrate: jest.fn(),
  saveCrate: jest.fn(),
  deleteCrate: jest.fn(),
}));
jest.mock('../../../lib/musicLibrary', () => ({
  getFolders: async () => [{ path: '/library/trance', name: 'Trance' }],
}));
jest.mock('../../../lib/usePagedList', () => ({
  usePagedList: () => ({ items: [], total: 0, loading: false }),
}));
jest.mock('./TrackTable', () => jest.fn(() => <p>Crate track list</p>));
const button = (container, text) =>
  [...container.querySelectorAll('button')].find((item) =>
    item.textContent.includes(text),
  );
const field = (container, text) =>
  [...container.querySelectorAll('label')]
    .find((item) => item.textContent.startsWith(text))
    .querySelector('input,select');

describe('Smart crate workflow', () => {
  let container;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    TrackTable.mockImplementation(() => <p>Crate track list</p>);
    useLibraryActivity.mockReturnValue({ libraryRevision: 0 });
    previewCrate.mockResolvedValue({
      total: 15,
      tracks: [{ path: 'a', title: 'Atlantis', artist: 'Artist' }],
    });
    getCrates.mockResolvedValue([
      {
        id: 'recent',
        name: 'Fresh arrivals',
        description: 'New tracks',
        starter: true,
        rules: { addedWithinDays: 30 },
        trackCount: 15,
      },
    ]);
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  it('previews server membership and saves rules rather than copying tracks', async () => {
    expect.hasAssertions();
    const onSaved = jest.fn();
    saveCrate.mockResolvedValue({
      id: 'new',
      name: 'Trance discoveries',
      rules: {},
      revision: 1,
    });
    await act(async () => {
      ReactDOM.render(
        <CrateEditor
          crate={{}}
          onCancel={() => {}}
          onSaved={onSaved}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('15 tracks');
    act(() => {
      Simulate.change(field(container, 'Crate name'), {
        target: { value: 'Trance discoveries' },
      });
      Simulate.change(field(container, 'BPM from'), {
        target: { value: '125' },
      });
      Simulate.change(field(container, 'BPM to'), { target: { value: '130' } });
      Simulate.change(field(container, 'Inside folder'), {
        target: { value: '/library/trance' },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(previewCrate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bpmMin: 125,
        bpmMax: 130,
        folder: '/library/trance',
      }),
    );
    await act(async () => Simulate.submit(container.querySelector('form')));
    expect(saveCrate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Trance discoveries',
        rules: expect.objectContaining({ bpmMin: 125, bpmMax: 130 }),
      }),
    );
    expect(saveCrate.mock.calls[0][0]).not.toHaveProperty('tracks');
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new' }),
    );
  });
  it('shows a preview error and prevents saving invalid rules', async () => {
    expect.hasAssertions();
    previewCrate.mockRejectedValue({
      response: {
        data: { message: 'Use a BPM range with the minimum first.' },
      },
    });
    await act(async () => {
      ReactDOM.render(
        <CrateEditor
          crate={{ name: 'Invalid' }}
          onCancel={() => {}}
          onSaved={() => {}}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('minimum first');
    expect(button(container, 'Save smart crate').disabled).toBe(true);
    expect(saveCrate).not.toHaveBeenCalled();
  });
  it('keeps the editor open on conflicting edits', async () => {
    expect.hasAssertions();
    saveCrate.mockRejectedValue({
      response: { data: { message: 'This crate changed in another window.' } },
    });
    const onSaved = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <CrateEditor
          crate={{ id: 'id', name: 'My crate', revision: 1 }}
          onCancel={() => {}}
          onSaved={onSaved}
        />,
        container,
      );
    });
    await act(async () => Simulate.submit(container.querySelector('form')));
    expect(container.textContent).toContain('another window');
    expect(field(container, 'Crate name').value).toBe('My crate');
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('refreshes counts after a library update and duplicates starter rules', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<SmartCratesView />, container);
    });
    expect(container.textContent).toContain('15 tracks');
    getCrates.mockResolvedValue([
      {
        id: 'recent',
        name: 'Fresh arrivals',
        starter: true,
        rules: { addedWithinDays: 30 },
        trackCount: 16,
      },
    ]);
    useLibraryActivity.mockReturnValue({ libraryRevision: 1 });
    await act(async () => {
      ReactDOM.render(<SmartCratesView />, container);
    });
    expect(container.textContent).toContain('16 tracks');
    await act(async () => Simulate.click(button(container, 'Make a copy')));
    expect(field(container, 'Crate name').value).toBe('Fresh arrivals copy');
    expect(field(container, 'Added within days').value).toBe('30');
  });
  it('filters automatic collections and retains analysed-only exclusive rules when copied', async () => {
    expect.hasAssertions();
    getCrates.mockResolvedValue([
      {
        id: 'auto-bpm',
        name: '120–<130 BPM',
        starter: true,
        collection: 'BPM',
        rules: {
          bpmMin: 120,
          bpmMax: 130,
          bpmMaxExclusive: true,
          analysedOnly: true,
        },
        trackCount: 2,
      },
      {
        id: 'auto-genre',
        name: 'Techno',
        starter: true,
        collection: 'Genre',
        rules: { genre: 'Techno', analysedOnly: true },
        trackCount: 3,
      },
    ]);
    await act(async () => {
      ReactDOM.render(<SmartCratesView />, container);
    });
    await act(async () =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (item) => item.textContent === 'BPM',
        ),
      ),
    );
    expect(container.textContent).toContain('120–<130 BPM');
    expect(container.textContent).not.toContain('Techno');
    await act(async () => Simulate.click(button(container, 'Make a copy')));
    expect(previewCrate).toHaveBeenLastCalledWith(
      expect.objectContaining({ bpmMaxExclusive: true, analysedOnly: true }),
    );
  });

  it('resolves a bounded ordered queue beyond the displayed page and keeps the clicked track selected', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <CrateTracks crate={{ id: 'genre/techno' }} />,
        container,
      );
    });
    expect(getCratePage).not.toHaveBeenCalled();
    const items = Array.from({ length: 200 }, (_, index) => ({
      path: `/track-${index + 49}`,
    }));
    getCratePage.mockResolvedValue({ items, total: 300 });
    let queue;
    await act(async () => {
      queue = await TrackTable.mock.calls
        .at(-1)[0]
        .resolvePlaybackQueue({ path: '/track-99' }, 99);
    });
    expect(getCratePage).toHaveBeenCalledWith(
      expect.objectContaining({
        crateId: 'genre/techno',
        sort: 'title',
        descending: false,
        search: '',
        offset: 49,
        limit: 500,
      }),
    );
    expect(queue).toEqual({ tracks: items, index: 50 });
    expect(queue.tracks[queue.index + 1].path).toBe('/track-100');
  });

  it('retains the active filter and descending sort in playback requests', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<CrateTracks crate={{ id: 'key' }} />, container);
    });
    act(() => {
      const props = TrackTable.mock.calls.at(-1)[0];
      props.serverFilter.onChange('mix');
      props.serverSort.onChange('bpm', 'desc');
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    getCratePage.mockResolvedValue({
      items: [{ path: '/selected' }],
      total: 1,
    });
    await act(async () => {
      await TrackTable.mock.calls
        .at(-1)[0]
        .resolvePlaybackQueue({ path: '/selected' }, 0);
    });
    expect(getCratePage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: 'mix',
        sort: 'bpm',
        descending: true,
        offset: 0,
      }),
    );
  });

  it('keeps playback unchanged on a failed fetch or changed crate membership', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<CrateTracks crate={{ id: 'recent' }} />, container);
    });
    getCratePage
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], total: 0 });
    let result;
    await act(async () => {
      result = await TrackTable.mock.calls
        .at(-1)[0]
        .resolvePlaybackQueue({ path: '/removed' }, 0);
    });
    expect(result).toBeNull();
    expect(container.textContent).toContain(
      'Could not load the crate playback queue',
    );
    await act(async () => {
      result = await TrackTable.mock.calls
        .at(-1)[0]
        .resolvePlaybackQueue({ path: '/removed' }, 0);
    });
    expect(result).toBeNull();
    expect(container.textContent).toContain('no longer in this crate');
  });

  it('discards stale playback responses after another selection or leaving the crate', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<CrateTracks crate={{ id: 'recent' }} />, container);
    });
    let finish;
    getCratePage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [{ path: '/new' }], total: 1 });
    const resolveQueue = TrackTable.mock.calls.at(-1)[0].resolvePlaybackQueue;
    let old;
    act(() => {
      old = resolveQueue({ path: '/old' }, 0);
    });
    let newest;
    await act(async () => {
      newest = await resolveQueue({ path: '/new' }, 1);
    });
    await act(async () => {
      finish({ items: [{ path: '/old' }], total: 1 });
    });
    await expect(old).resolves.toBeNull();
    expect(newest.index).toBe(0);
    getCratePage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      old = resolveQueue({ path: '/old' }, 0);
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    finish({ items: [{ path: '/old' }], total: 1 });
    await expect(old).resolves.toBeNull();
  });
});
