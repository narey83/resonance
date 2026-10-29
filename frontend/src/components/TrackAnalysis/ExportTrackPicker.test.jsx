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
  it('starts expanded and preserves selection across browse views', () => {
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(3);
    check('A', true);
    check('B', true);
    const picker = container.querySelector('select');
    for (const view of ['album', 'artist', 'tracks', 'folder']) {
      act(() => {
        Simulate.change(picker, {
          target: { value: view },
        });
      });
      expect(selected).toHaveLength(3);
      expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(3);
    }
  });
  it('groups nested folders beneath their shared library root', () => {
    expect.hasAssertions();
    const tree = exportFolderTree(tracks);
    expect(tree.name).toBe('library');
    expect(tree.folders.map((folder) => folder.name)).toEqual(['A', 'B']);
    expect(tree.folders[0].folders[0].tracks[0].title).toBe('Two');
  });
  it('includes descendants without duplicates and marks partial folders', () => {
    expect.hasAssertions();
    check('A', true);
    expect(selected).toEqual([tracks[0].path, tracks[1].path]);
    check('B', true);
    check('A', true);
    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    act(() => {
      Simulate.change(container.querySelector('[aria-label="Export Two"]'), {
        target: { checked: false },
      });
    });
    expect(
      container.querySelector('[aria-label="Select folder A"]').indeterminate,
    ).toBe(true);
    check('A', false);
    expect(selected).toEqual([tracks[2].path]);
    expect(
      container.querySelector('[aria-label="Select folder library"]'),
    ).toBeNull();
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
  it('keeps large folders collapsed and selects every descendant without rendering each track', () => {
    expect.hasAssertions();
    const large = Array.from({ length: 12_000 }, (_, index) => ({
      path: `/downloads/Album ${Math.floor(index / 20)}/${index}.flac`,
      title: `Track ${index}`,
    }));
    const Large = () => {
      const [paths, setPaths] = useState([]);
      selected = paths;
      return (
        <ExportTrackPicker
          onChange={setPaths}
          selected={paths}
          tracks={large}
        />
      );
    };

    act(() => {
      ReactDOM.render(<Large />, container);
    });
    expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(0);
    expect(container.querySelectorAll('.usb-picker-folder-row')).toHaveLength(
      100,
    );
    expect(
      container.querySelector('[aria-label="Select folder downloads"]'),
    ).toBeNull();
    check('Album 0', true);
    expect(selected).toHaveLength(20);
    const toggle = [
      ...container.querySelectorAll('.usb-picker-folder-toggle'),
    ].find((item) => item.textContent === 'Album 0');
    act(() => {
      Simulate.click(toggle);
    });
    expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(20);
    expect(
      [...container.querySelectorAll('.usb-picker-track input')].every(
        (input) => input.checked,
      ),
    ).toBe(true);
    const more = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Show more folders or groups',
    );
    act(() => {
      Simulate.click(more);
    });
    expect(container.querySelectorAll('.usb-picker-folder-row')).toHaveLength(
      200,
    );
    expect(selected).toHaveLength(20);
  });
  it('bounds large all-track groups while folder selection still includes undisplayed tracks', () => {
    expect.hasAssertions();
    const large = Array.from({ length: 300 }, (_, index) => ({
      path: `/downloads/Album/${index}.flac`,
      title: `Track ${index}`,
    }));
    act(() => {
      ReactDOM.render(
        <ExportTrackPicker
          onChange={() => {}}
          selected={[]}
          tracks={large}
        />,
        container,
      );
    });
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: 'tracks' },
      });
    });
    act(() => {
      Simulate.click(container.querySelector('.usb-picker-folder-toggle'));
    });
    expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(100);
    const more = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Show more in All tracks',
    );
    act(() => {
      Simulate.click(more);
    });
    expect(container.querySelectorAll('.usb-picker-track')).toHaveLength(200);
  });
});
