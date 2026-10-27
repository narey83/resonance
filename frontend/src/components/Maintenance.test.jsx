import { isAdmin } from '../lib/token';
import MaintenanceButton from './MaintenanceButton';
import MaintenanceNotice from './MaintenanceNotice';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../lib/token', () => ({
  isAdmin: jest.fn(),
  getToken: () => 'test-admin-token',
}));
jest.mock('react-toastify', () => ({
  toast: { info: jest.fn(), error: jest.fn() },
}));

describe('maintenance presentation and control', () => {
  let container;
  let originalFetch;
  beforeEach(() => {
    jest.useFakeTimers();
    originalFetch = global.fetch;
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  it('shows maintenance independently of App and clears on recovery', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ maintenance: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ maintenance: false }),
      });
    await act(async () => {
      ReactDOM.render(<MaintenanceNotice />, container);
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'reconnect automatically',
    );
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('does not label an ordinary outage as planned maintenance', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockResolvedValue({ ok: false });
    await act(async () => {
      ReactDOM.render(<MaintenanceNotice />, container);
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('requires an admin and explicit restart confirmation', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockResolvedValue({ ok: true });
    isAdmin.mockReturnValue(false);
    act(() => {
      ReactDOM.render(
        <MaintenanceButton className="info-action-btn" />,
        container,
      );
    });
    expect(container.querySelector('button')).toBeNull();
    isAdmin.mockReturnValue(true);
    act(() => {
      ReactDOM.render(
        <MaintenanceButton className="info-action-btn" />,
        container,
      );
    });
    expect(container.querySelector('button').className).toBe('info-action-btn');
    act(() => Simulate.click(container.querySelector('button')));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('playback and transfers');
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/maintenance/control'),
      expect.objectContaining({
        method: 'POST',
        body: '{"action":"restart"}',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-admin-token',
        }),
      }),
    );
  });
});
