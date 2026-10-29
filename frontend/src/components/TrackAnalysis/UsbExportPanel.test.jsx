import api from '../../lib/api';
import UsbExportPanel from './UsbExportPanel';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));
describe('USB export selection and failures', () => {
  let container;
  const button = (label) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === label,
    );
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [
          { path: '/library/one.mp3', title: 'One', artist: 'Artist' },
          { path: '/library/two.flac', title: 'Two' },
        ],
      },
    });
    api.post.mockImplementation((url) =>
      url === '/analysis/usb-export/library'
        ? api.get('/analysis/usb-export')
        : Promise.resolve({
            data: {
              jobId: 'job',
              status: 'completed',
              total: 2,
              prepared: 2,
              downloadAvailable: true,
            },
          }),
    );
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
  });
  it('uses the selected source folder as the exported playlist name', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'folder' } },
      );
    });
    expect(container.querySelector('input[maxlength]').value).toBe('library');
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export', {
      paths: ['/library/one.mp3', '/library/two.flac'],
      playlistName: 'library',
      profile: 'dual',
    });
  });
  it('offers an album name across folders only when all selected tracks share it', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [
          {
            path: '/music/disc-one/one.mp3',
            title: 'One',
            album: 'A shared album',
          },
          {
            path: '/music/disc-two/two.mp3',
            title: 'Two',
            album: 'A shared album',
          },
        ],
      },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    expect(container.querySelector('option[value="folder"]').disabled).toBe(
      true,
    );
    expect(container.querySelector('option[value="album"]').disabled).toBe(
      false,
    );
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'album' } },
      );
    });
    expect(container.querySelector('input[maxlength]').value).toBe(
      'A shared album',
    );
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post.mock.calls[0][1].playlistName).toBe('A shared album');
  });
  it('does not treat identical folder basenames in separate locations as one source', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [
          { path: '/first/Album/one.mp3', title: 'One', album: 'First album' },
          {
            path: '/second/Album/two.mp3',
            title: 'Two',
            album: 'Second album',
          },
        ],
      },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    expect(container.querySelector('option[value="folder"]').disabled).toBe(
      true,
    );
    expect(container.querySelector('option[value="album"]').disabled).toBe(
      true,
    );
    expect(container.querySelector('input[maxlength]').value).toBe('Resonance');
  });
  it('restores the custom name when the selection no longer has one source folder', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [
          { path: '/first/one.mp3', title: 'One' },
          { path: '/second/two.mp3', title: 'Two' },
        ],
      },
    });
    await act(async () => {
      ReactDOM.render(
        <UsbExportPanel initialPlaylistName="My set" />,
        container,
      );
    });
    act(() => {
      Simulate.change(container.querySelector('[aria-label="Export One"]'), {
        target: { checked: true },
      });
    });
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'folder' } },
      );
    });
    expect(container.querySelector('input[maxlength]').value).toBe('first');
    act(() => {
      Simulate.click(button('Select all'));
    });
    expect(
      container.querySelector('[aria-label="Playlist name source"]').value,
    ).toBe('custom');
    expect(container.querySelector('input[maxlength]').value).toBe('My set');
  });
  it('switches to a custom name when a suggested name is edited', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'folder' } },
      );
    });
    act(() => {
      Simulate.change(container.querySelector('input[maxlength]'), {
        target: { value: 'My edited album' },
      });
    });
    expect(
      container.querySelector('[aria-label="Playlist name source"]').value,
    ).toBe('custom');
    expect(container.querySelector('input[maxlength]').value).toBe(
      'My edited album',
    );
  });
  it('shortens long source names without splitting a Unicode character and explains the limit', async () => {
    expect.hasAssertions();
    const folder = 'a'.repeat(99) + '😀 album';
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [{ path: `/music/${folder}/one.mp3`, title: 'One' }],
      },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'folder' } },
      );
    });
    expect(container.querySelector('input[maxlength]').value).toBe(
      'a'.repeat(99),
    );
    expect(container.textContent).toContain(
      'shortened to fit the 100-character playlist limit',
    );
  });
  it('recognises Windows folder separators without changing canonical track paths', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        tracks: [{ path: 'C:\\Music\\Album\\one.mp3', title: 'One' }],
      },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => {
      Simulate.click(button('Select all'));
    });
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Playlist name source"]'),
        { target: { value: 'folder' } },
      );
    });
    expect(container.querySelector('input[maxlength]').value).toBe('Album');
  });
  it('guides selection, player settings, review and export without losing choices', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportPanel wizard />, container);
    });
    expect(button('Continue').disabled).toBe(true);
    act(() => {
      Simulate.click(button('Select all'));
    });
    act(() => {
      Simulate.click(button('Continue'));
    });
    expect(
      container.querySelector('[aria-current="step"]').textContent,
    ).toContain('Player and playlist');
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: 'legacy' },
      });
      Simulate.change(container.querySelector('input[maxlength]'), {
        target: { value: 'Weekend' },
      });
      Simulate.click(button('Continue'));
    });
    expect(container.textContent).toContain('Playlist: Weekend');
    expect(container.textContent).toContain('Legacy players');
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export', {
      paths: ['/library/one.mp3', '/library/two.flac'],
      playlistName: 'Weekend',
      profile: 'legacy',
    });
    expect(
      container.querySelector('[aria-current="step"]').textContent,
    ).toContain('Export and transfer');
    expect(button('Download USB ZIP')).toBeDefined();
  });
  it('preselects only the library selection and posts canonical export paths', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <UsbExportPanel initialPaths={['library/two.flac']} />,
        container,
      );
    });
    expect(
      container.querySelectorAll('input[aria-label^="Export "]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('input[aria-label^="Export "]').checked,
    ).toBe(true);
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export', {
      paths: ['/library/two.flac'],
      playlistName: 'Resonance',
      profile: 'dual',
    });
  });
  it('preserves the Set Planner name and running order through the export wizard', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <UsbExportPanel
          initialPaths={['/library/two.flac', '/library/one.mp3']}
          initialPlaylistName="Late room set"
          wizard
        />,
        container,
      );
    });
    act(() => Simulate.click(button('Continue')));
    expect(container.querySelector('input[maxlength]').value).toBe(
      'Late room set',
    );
    act(() => Simulate.click(button('Continue')));
    await act(async () => Simulate.click(button('Prepare USB export')));
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export', {
      paths: ['/library/two.flac', '/library/one.mp3'],
      playlistName: 'Late room set',
      profile: 'dual',
    });
  });
  it('does not silently export the whole library when the selection is unavailable', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(
        <UsbExportPanel initialPaths={['missing.mp3']} />,
        container,
      );
    });
    expect(button('Prepare USB export').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'unavailable',
    );
  });
  it('exports selected indexed paths with the selected player profile and playlist', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    expect(button('Prepare USB export').disabled).toBe(true);
    act(() => {
      Simulate.click(button('Select all'));
      Simulate.change(container.querySelector('select'), {
        target: { value: 'legacy' },
      });
    });
    act(() =>
      Simulate.change(container.querySelector('input[maxlength]'), {
        target: { value: 'Club' },
      }),
    );
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post).toHaveBeenCalledWith('/analysis/usb-export', {
      paths: ['/library/one.mp3', '/library/two.flac'],
      playlistName: 'Club',
      profile: 'legacy',
    });
    expect(button('Download USB ZIP')).toBeDefined();
    expect(container.textContent).toContain('Hardware verification is pending');
  });
  it('shows server validation failures without claiming an export completed', async () => {
    expect.hasAssertions();
    api.post.mockRejectedValue({
      response: { data: 'Full enhanced analysis is required.' },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => Simulate.click(button('Select all')));
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      'Full enhanced analysis is required.',
    );
    expect(button('Download USB ZIP')).toBeUndefined();
  });
  it('disables export when the worker is not configured', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        enabled: false,
        tracks: [{ path: '/library/one.mp3', title: 'One' }],
      },
    });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    act(() => Simulate.click(button('Select all')));
    expect(button('Prepare USB export').disabled).toBe(true);
  });
  it('downloads the advertised native helper through the authenticated API', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({
        data: {
          enabled: true,
          tracks: [],
          helperPlatforms: ['macos', 'source'],
        },
      })
      .mockResolvedValueOnce({ data: new Blob(['archive']) });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:helper',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => {},
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    await act(async () => {
      Simulate.click(button('Download Resonance Bridge for Mac'));
    });
    expect(api.get).toHaveBeenLastCalledWith('/bridge/helper?platform=macos', {
      responseType: 'blob',
    });
    expect(click).toHaveBeenCalledWith();
    expect(container.textContent).toContain('same installed helper now');
    click.mockRestore();
  });
  it('shows a clear helper download failure', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({
        data: { enabled: true, tracks: [], helperPlatforms: ['source'] },
      })
      .mockRejectedValueOnce({
        response: {
          data: 'Requested helper archive is not available on this instance.',
        },
      });
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    await act(async () => {
      Simulate.click(button('Download cross-platform source and build guide'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toBe(
      'Requested helper archive is not available on this instance.',
    );
    expect(button('Download Resonance Bridge for Mac').disabled).toBe(true);
  });
  it('shows an honest loading state until the track catalogue arrives', async () => {
    expect.hasAssertions();
    let complete;
    api.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => {
      ReactDOM.render(<UsbExportPanel />, container);
    });
    expect(container.textContent).toContain('Loading export tracks');
    expect(container.textContent).not.toContain('worker is not configured');
    await act(async () => {
      complete({ data: { enabled: true, tracks: [] } });
    });
    expect(container.textContent).not.toContain('Loading export tracks');
  });
  it('fetches only the selected source tracks and submits its reviewed snapshot', async () => {
    expect.hasAssertions();
    api.post
      .mockResolvedValueOnce({
        data: {
          enabled: true,
          tracks: [
            { path: '/library/two.flac', title: 'Two' },
            { path: '/library/one.mp3', title: 'One' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { jobId: 'job', status: 'completed', total: 2, prepared: 2 },
      });
    const paths = ['/library/two.flac', '/library/one.mp3'];
    await act(async () => {
      ReactDOM.render(
        <UsbExportPanel
          initialPaths={paths}
          selectionId="reviewed"
        />,
        container,
      );
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      '/analysis/usb-export/library',
      paths,
    );
    expect(button('Clear selection').disabled).toBe(true);
    await act(async () => {
      Simulate.click(button('Prepare USB export'));
    });
    expect(api.post).toHaveBeenLastCalledWith('/analysis/usb-export', {
      selectionId: 'reviewed',
      paths,
      playlistName: 'Resonance',
      profile: 'dual',
    });
  });
});
