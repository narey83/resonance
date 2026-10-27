import { resolveLibraryTracks } from '../lib/libraryWorkbench';
import usePlayerMetadata from './usePlayerMetadata';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../lib/libraryWorkbench', () => ({
  resolveLibraryTracks: jest.fn(),
}));
jest.mock('../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: 1 }),
}));
const Harness = ({ track }) => {
  const metadata = usePlayerMetadata(track);
  return (
    <span>
      {metadata.bpm || '—'} / {metadata.key || '—'}
    </span>
  );
};

describe('player metadata recovery', () => {
  it('renders safely before a track is loaded', () => {
    const container = document.createElement('div');
    act(() => {
      ReactDOM.render(<Harness />, container);
    });
    expect(container.textContent).toBe('— / —');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
  it('recovers missing playlist metrics without mutating playback identity', async () => {
    expect.hasAssertions();
    const track = { path: 'song', filename: 'song', localRelativePath: 'song' };
    resolveLibraryTracks.mockResolvedValue([
      { path: 'song', bpm: 138, key: 'Gm' },
    ]);
    const container = document.createElement('div');
    await act(async () => {
      ReactDOM.render(<Harness track={track} />, container);
    });
    expect(container.textContent).toBe('138 / Gm');
    expect(track).toEqual({
      path: 'song',
      filename: 'song',
      localRelativePath: 'song',
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
  it('discards an older track lookup that completes after switching tracks', async () => {
    expect.hasAssertions();
    let finishA;
    resolveLibraryTracks
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishA = resolve;
        }),
      )
      .mockResolvedValueOnce([{ bpm: 128, key: 'C' }]);
    const container = document.createElement('div');
    await act(async () => {
      ReactDOM.render(
        <Harness track={{ path: 'a', localRelativePath: 'a' }} />,
        container,
      );
    });
    await act(async () => {
      ReactDOM.render(
        <Harness track={{ path: 'b', localRelativePath: 'b' }} />,
        container,
      );
    });
    await act(async () => {
      finishA([{ bpm: 140, key: 'Am' }]);
    });
    expect(container.textContent).toBe('128 / C');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
});

const BothViews = ({ popped, popup, track }) => {
  const metadata = usePlayerMetadata(track);
  const view = (
    <span>
      {metadata.bpm} / {metadata.key}
    </span>
  );
  return (
    <>
      {view}
      {popped && ReactDOM.createPortal(view, popup)}
    </>
  );
};

describe('metadata in a separate player document', () => {
  it('updates the dock and popout together through track changes and docking', async () => {
    expect.hasAssertions();
    const dock = document.createElement('div');
    const popoutDoc = document.implementation.createHTMLDocument('Player');
    const popup = popoutDoc.createElement('div');
    popoutDoc.body.append(popup);

    resolveLibraryTracks.mockImplementation(async ([path]) => [
      { a: { bpm: 138, key: 'Gm' }, b: { bpm: 137, key: 'F' } }[path],
    ]);
    for (const [path, expected] of [
      ['a', '138 / Gm'],
      ['b', '137 / F'],
    ]) {
      await act(async () => {
        ReactDOM.render(
          <BothViews
            popped
            popup={popup}
            track={{ localRelativePath: path }}
          />,
          dock,
        );
      });
      expect(dock.textContent).toBe(expected);
      expect(popup.textContent).toBe(expected);
    }

    await act(async () => {
      ReactDOM.render(
        <BothViews
          popped={false}
          popup={popup}
          track={{ localRelativePath: 'b' }}
        />,
        dock,
      );
    });
    expect(dock.textContent).toBe('137 / F');
    expect(popup.textContent).toBe('');
    act(() => {
      ReactDOM.unmountComponentAtNode(dock);
    });
  });
});
