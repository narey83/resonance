import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import {
  getCrates,
  previewCrate,
  saveCrate,
} from '../../../lib/libraryWorkspace';
import SmartCratesView, { CrateEditor } from './SmartCratesView';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: jest.fn(),
}));
jest.mock('../../../lib/libraryWorkspace', () => ({
  ...jest.requireActual('../../../lib/libraryWorkspace'),
  getCrates: jest.fn(),
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
jest.mock('./TrackTable', () => () => <p>Crate track list</p>);
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
});
