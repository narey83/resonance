import api from '../../lib/api';
import AppsIntegrations, { detectPlatform } from './AppsIntegrations';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/api', () => ({ get: jest.fn() }));

describe('Bridge platform detection', () => {
  it.each([
    ['Windows NT 10.0; Win64; x64', 'windows'],
    ['Macintosh; Intel Mac OS X 10_15_7', 'macos'],
    ['X11; Linux x86_64', 'linux'],
    ['Linux; Android 15', null],
    ['iPhone; CPU iPhone OS 18 like Mac OS X', null],
    ['', null],
  ])('recommends the desktop platform for %s', (agent, expected) => {
    expect(detectPlatform(agent)).toBe(expected);
  });
});

describe('Apps & integrations', () => {
  let container;
  let click;
  const findButton = (label) =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    );
  const render = async () => {
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <AppsIntegrations />
        </MemoryRouter>,
        container,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    jest.useFakeTimers();
    api.get.mockResolvedValue({
      data: { helperPlatforms: ['macos', 'windows', 'linux', 'source'] },
    });
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, writable: true, value: jest.fn() },
      revokeObjectURL: { configurable: true, writable: true, value: jest.fn() },
    });
    jest
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:bridge-test');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation();
    click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it('lists each OS, its actual architecture and setup links', async () => {
    expect.hasAssertions();
    await render();
    expect(api.get).toHaveBeenCalledWith(
      '/bridge',
      expect.objectContaining({ signal: expect.anything() }),
    );
    for (const name of ['macOS', 'Windows', 'Linux'])
      expect(findButton(`Download for ${name}`).disabled).toBe(false);
    expect(container.textContent).toContain('Apple silicon');
    expect(container.textContent).toContain('Intel Macs are not included');
    expect(container.textContent).toContain('Debian / Ubuntu');
    expect(container.querySelector('a[href$="/export"]')).not.toBeNull();
    expect(container.querySelector('a[href$="/networklink"]')).not.toBeNull();
    expect(container.textContent).toContain('Start at sign-in');
  });
  it('uses the authenticated blob API and Bridge filename for the installer', async () => {
    expect.hasAssertions();
    await render();
    const blob = new Blob(['installer']);
    api.get.mockResolvedValueOnce({ data: blob });
    await act(async () => {
      Simulate.click(findButton('Download for Windows'));
    });
    expect(api.get).toHaveBeenLastCalledWith(
      '/bridge/download?platform=windows',
      expect.objectContaining({
        responseType: 'blob',
        signal: expect.anything(),
      }),
    );
    expect({
      filename: click.mock.instances[0].download,
      href: click.mock.instances[0].href,
    }).toEqual({
      filename: 'resonance-bridge-windows-setup.exe',
      href: 'blob:bridge-test',
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bridge-test');
  });
  it('disables unpublished installers and ignores unknown server platform names', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: { helperPlatforms: ['source', 'untrusted-platform'] },
    });
    await render();
    expect(findButton('Download for macOS').disabled).toBe(true);
    expect(findButton('Download for Windows').disabled).toBe(true);
    expect(findButton('Download for Linux').disabled).toBe(true);
    expect(findButton('Download source & build guide').disabled).toBe(false);
    expect(container.textContent).not.toContain('untrusted-platform');
  });
  it('shows download failures without pretending a file was downloaded', async () => {
    expect.hasAssertions();
    await render();
    api.get.mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => {
      Simulate.click(findButton('Download for macOS'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'download could not be completed',
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(findButton('Download for macOS').disabled).toBe(false);
  });
  it('can retry a failed installer-list request', async () => {
    expect.hasAssertions();
    api.get.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Could not load Bridge downloads',
    );
    expect(container.textContent).not.toContain(
      'Not available on this instance',
    );
    await act(async () => {
      Simulate.click(findButton('Reload downloads'));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(findButton('Download for Linux').disabled).toBe(false);
  });
  it('aborts a pending download when leaving the page', async () => {
    expect.hasAssertions();
    await render();
    api.get.mockImplementationOnce(() => new Promise(() => {}));
    act(() => {
      Simulate.click(findButton('Download for Windows'));
    });
    const request = api.get.mock.calls.at(-1)[1];
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(request.signal.aborted).toBe(true);
  });
});
