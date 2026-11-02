import * as prefs from '../../lib/prefs';
import NotificationCentre from './NotificationCentre';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/prefs', () => ({ get: jest.fn(), set: jest.fn() }));

const events = [
  {
    id: 'message',
    type: 'PrivateMessageReceived',
    timestamp: new Date().toISOString(),
    read: false,
    data: {
      message: { username: 'Alice', message: 'Ready for the next set?' },
    },
  },
  {
    id: 'download',
    type: 'DownloadFileComplete',
    timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    read: true,
    data: { remoteFilename: 'music/track.flac' },
  },
  { id: 'unknown', type: 'FutureEvent', timestamp: null, read: true, data: {} },
];

const click = (el) => act(() => Simulate.click(el));

describe('notification activity inbox', () => {
  let container;
  let launcher;
  let props;
  const button = (text) =>
    [...container.querySelectorAll('button')].find((el) =>
      el.textContent.includes(text),
    );
  const render = () =>
    act(() => {
      ReactDOM.render(
        <MemoryRouter>
          <NotificationCentre {...props} />
        </MemoryRouter>,
        container,
      );
    });
  beforeEach(() => {
    prefs.get.mockReset().mockReturnValue(false);
    prefs.set.mockReset();
    launcher = document.createElement('button');
    document.body.append(launcher);
    launcher.focus();
    container = document.createElement('div');
    document.body.append(container);
    props = {
      notifications: events,
      onClear: jest.fn(),
      onClose: jest.fn(),
      onMarkAllRead: jest.fn(),
      onSettingsChange: jest.fn(),
      settings: {},
    };
    render();
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    launcher.remove();
  });

  it('preserves unread status until explicitly marked read', () => {
    expect(props.onMarkAllRead).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.unread')).toHaveLength(1);
    click(button('Mark all read'));
    expect(props.onMarkAllRead).toHaveBeenCalledTimes(1);
    props.notifications = events.map((n) => ({ ...n, read: true }));
    render();
    expect(button('Mark all read').disabled).toBe(true);
  });

  it('filters category, search text and unread state together', () => {
    click(button('Messages'));
    expect(container.querySelectorAll('.nc-item')).toHaveLength(1);
    expect(container.querySelector('.nc-feed').textContent).toContain('Alice');
    const input = container.querySelector(
      '[aria-label="Search notifications"]',
    );
    act(() => Simulate.change(input, { target: { value: 'not present' } }));
    expect(container.querySelectorAll('.nc-item')).toHaveLength(0);
    click(button('Show all activity'));
    const unread = container.querySelector('.nc-filter-line input');
    act(() => Simulate.change(unread, { target: { checked: true } }));
    expect(container.querySelectorAll('.nc-item')).toHaveLength(1);
  });

  it('saves both checkbox choices', () => {
    const input = container.querySelector('.nc-filter-line input');
    expect(input.checked).toBe(false);
    for (const checked of [true, false]) {
      act(() => Simulate.change(input, { target: { checked } }));
      expect(prefs.set).toHaveBeenLastCalledWith(
        'resonance-notifications-unread-only',
        checked,
      );
    }
  });

  it('restores the saved filter on reopen and saves Show all activity', () => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    prefs.get.mockReturnValue(true);
    props.notifications = events.filter((n) => n.read);
    render();
    expect(prefs.get).toHaveBeenCalledWith(
      'resonance-notifications-unread-only',
      false,
    );
    expect(container.querySelector('.nc-filter-line input').checked).toBe(true);
    expect(container.querySelectorAll('.nc-item')).toHaveLength(0);
    click(button('Show all activity'));
    expect(prefs.set).toHaveBeenLastCalledWith(
      'resonance-notifications-unread-only',
      false,
    );
    expect(container.querySelectorAll('.nc-item')).toHaveLength(2);
  });

  it('groups history and handles unknown events or missing timestamps', () => {
    expect(container.querySelector('[aria-label="Today"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Yesterday"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Earlier"]').textContent,
    ).toContain('Time unavailable');
    const download = [...container.querySelectorAll('a')].find((el) =>
      el.textContent.includes('View downloads'),
    );
    expect(download.getAttribute('href')).toContain('/downloads');
    expect(
      container.querySelector('.nc-item-action').getAttribute('href'),
    ).toContain('/chat?user=Alice');
  });

  it('uses the declared defaults and saves a preference change', () => {
    click(button('Preferences'));
    const files = container.querySelector(
      '[aria-label="Download complete (individual files)"]',
    );
    expect(files.checked).toBe(false);
    const messages = container.querySelector('[aria-label="Private messages"]');
    expect(messages.checked).toBe(true);
    act(() => Simulate.change(files, { target: { checked: true } }));
    expect(props.onSettingsChange).toHaveBeenCalledWith(
      'DownloadFileComplete',
      true,
    );
  });

  it('offers switches for action notices and server status', () => {
    click(button('Preferences'));
    for (const [label, key] of [
      ['Successful actions', 'ActionSuccess'],
      ['Information', 'ActionInfo'],
      ['Warnings', 'ActionWarning'],
      ['Errors', 'ActionError'],
      ['Server status', 'ServerStatus'],
    ]) {
      const input = container.querySelector(`[aria-label="${label}"]`);
      expect(input.checked).toBe(true);
      act(() => Simulate.change(input, { target: { checked: false } }));
      expect(props.onSettingsChange).toHaveBeenLastCalledWith(key, false);
    }
  });

  it('traps keyboard focus and closes with Escape', () => {
    const close = container.querySelector('[aria-label="Close notifications"]');
    expect(document.activeElement).toBe(close);
    const buttons = container.querySelectorAll('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(close);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the launcher when closed', () => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(document.activeElement).toBe(launcher);
    render();
  });

  it('only clears history when the user chooses the clear action', () => {
    expect(props.onClear).not.toHaveBeenCalled();
    click(button('Clear history'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
