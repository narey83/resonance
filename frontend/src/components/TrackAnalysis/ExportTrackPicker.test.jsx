import ExportTrackPicker, { exportFolderTree } from './ExportTrackPicker';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

const tracks = [
  { path: '/music/library/A/one.flac', title: 'One', artist: 'Artist' },
  { path: '/music/library/A/deep/two.mp3', title: 'Two' },
  { path: '/music/library/B/three.wav', title: 'Three' },
];
describe('Export folder picker', () => {
  let container;
  let selected;
  const Harness = () => {
    const [paths, setPaths] = useState([]);
    selected = paths;
    return (
      <ExportTrackPicker
        onChange={setPaths}
        selected={paths}
        tracks={tracks}
      />
    );
  };

  const check = (name, value) => {
    act(() => {
      Simulate.change(
        container.querySelector(`[aria-label="Select folder ${name}"]`),
        { target: { checked: value } },
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    act(() => {
      ReactDOM.render(<Harness />, container);
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
  });
  it('groups nested folders beneath their shared library root', () => {
    expect.hasAssertions();
    const tree = exportFolderTree(tracks);
    expect(tree.name).toBe('library');
    expect(tree.folders.map((folder) => folder.name)).toEqual(['A', 'B']);
    expect(tree.folders[0].folders[0].tracks[0].title).toBe('Two');
  });
  it('includes descendants without duplicating overlapping selections', () => {
    expect.hasAssertions();
    check('A', true);
    expect(selected).toEqual([tracks[0].path, tracks[1].path]);
    check('library', true);
    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    check('A', false);
    expect(selected).toEqual([tracks[2].path]);
    expect(
      container.querySelector('[aria-label="Select folder library"]')
        .indeterminate,
    ).toBe(true);
  });
  it('selects only matching tracks in a filtered folder', () => {
    expect.hasAssertions();
    act(() => {
      Simulate.change(
        container.querySelector(
          '[aria-label="Search export folders and tracks"]',
        ),
        { target: { value: 'Two' } },
      );
    });
    check('A', true);
    expect(selected).toEqual([tracks[1].path]);
    expect(container.textContent).toContain('matching tracks only');
  });
  it('shows a clear empty search result while retaining selection', () => {
    expect.hasAssertions();
    check('A', true);
    act(() => {
      Simulate.change(
        container.querySelector(
          '[aria-label="Search export folders and tracks"]',
        ),
        { target: { value: 'not present' } },
      );
    });
    expect(container.querySelector('[role="status"]').textContent).toContain(
      'No matching',
    );
    expect(selected).toHaveLength(2);
  });
});
