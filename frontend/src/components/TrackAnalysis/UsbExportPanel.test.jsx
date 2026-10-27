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
    api.post.mockResolvedValue({
      data: {
        jobId: 'job',
        status: 'completed',
        total: 2,
        prepared: 2,
        downloadAvailable: true,
      },
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
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
    expect(api.get).toHaveBeenLastCalledWith(
      '/analysis/pioneer-link/helper?platform=macos',
      { responseType: 'blob' },
    );
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
});
