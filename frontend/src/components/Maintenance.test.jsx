import { isAdmin } from '../lib/token';
import MaintenanceButton from './MaintenanceButton';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../lib/token', () => ({
  isAdmin: jest.fn(),
  getToken: () => 'test-admin-token',
}));
jest.mock('../lib/activityNotices', () => ({
  toast: { info: jest.fn(), error: jest.fn() },
}));

describe('administrator restart control', () => {
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
