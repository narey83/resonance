import api from '../../../lib/api';
import Tools from './Tools';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/api', () => ({ get: jest.fn(), post: jest.fn() }));
const rows = [
  {
    id: 'ytdlp',
    name: 'yt-dlp',
    current: 'old',
    latest: 'new',
    canUpdate: true,
    updateAvailable: true,
  },
  {
    id: 'deno',
    name: 'Deno',
    current: 'old',
    latest: 'new',
    canUpdate: true,
    updateAvailable: true,
  },
  {
    id: 'bgutil',
    name: 'bgutil & Node runtime',
    current: 'old',
    latest: 'new',
    canUpdate: false,
    updateAvailable: true,
    note: 'Update the backend image.',
  },
];

describe('Administrator tools page', () => {
  let container;
  const button = (label) =>
    [...container.querySelectorAll('button')].find((item) =>
      item.textContent.includes(label),
    );
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockImplementation((_url, config) =>
      Promise.resolve({
        data: rows.map((row) =>
          config.params.check
            ? row
            : { ...row, latest: null, updateAvailable: null },
        ),
      }),
    );
    api.post.mockResolvedValue({ data: { version: 'new' } });
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.clearAllMocks();
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<Tools />, container);
    });
  };

  const check = async () => {
    await act(async () => {
      Simulate.click(button('Check for updates'));
    });
  };

  it('requires a successful check and explains bundled image updates', async () => {
    expect.hasAssertions();
    await render();
    expect(button('Update available').disabled).toBe(true);
    expect(container.textContent).toContain('Backend image update required');
    await check();
    expect(button('Update available').textContent).toContain('(2)');
    expect(button('Update available').disabled).toBe(false);
  });

  it('continues a batch after one failure and never tries to replace bundled tools', async () => {
    expect.hasAssertions();
    api.post.mockRejectedValueOnce({
      response: { data: { message: 'Download unavailable' } },
    });
    await render();
    await check();
    await act(async () => {
      Simulate.click(button('Update available'));
    });
    expect(api.post.mock.calls.map((call) => call[0])).toEqual([
      '/tools/ytdlp/update',
      '/tools/deno/update',
    ]);
    expect(container.textContent).toContain('Download unavailable');
    expect(container.textContent).toContain('1 of 2 updates completed.');
  });

  it('shows a failed inventory request and allows checking again', async () => {
    expect.hasAssertions();
    api.get.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await check();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('yt-dlp');
  });
});
