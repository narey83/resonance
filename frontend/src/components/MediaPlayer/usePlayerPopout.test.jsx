import usePlayerPopout, { playerWindowBounds } from './usePlayerPopout';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('Optional player popout', () => {
  let container;
  let player;
  let popup;
  let handlers;
  const Harness = () => {
    player = usePlayerPopout();
    return (
      <button
        onClick={() => player.open()}
        type="button"
      >
        Pop out
      </button>
    );
  };

  beforeEach(() => {
    container = document.createElement('div');
    handlers = {};
    popup = {
      document: document.implementation.createHTMLDocument(''),
      closed: false,
      focus: jest.fn(),
      close: jest.fn(),
      moveTo: jest.fn(),
      resizeTo: jest.fn(),
      addEventListener: jest.fn((type, callback) => {
        handlers[type] = callback;
      }),
      removeEventListener: jest.fn(),
    };
    const host = popup.document.createElement('div');
    host.id = 'player-root';
    popup.document.body.append(host);
    jest.spyOn(window, 'open').mockReturnValue(popup);
    act(() => {
      ReactDOM.render(<Harness />, container);
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    jest.restoreAllMocks();
  });
  it('remains docked until requested and reuses its existing window', () => {
    expect.hasAssertions();
    expect(window.open).not.toHaveBeenCalled();
    act(() => {
      Simulate.click(container.querySelector('button'));
    });
    expect(player.container).toBeNull();
    act(() => {
      handlers.load();
    });
    expect(player.container.ownerDocument).toBe(popup.document);
    expect(popup.document.querySelector('base').href).toBe(document.baseURI);
    act(() => {
      player.open();
    });
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open.mock.calls[0][0]).toContain('/player-popout.html');
    const bounds = playerWindowBounds();
    expect(window.open.mock.calls[0][2]).toContain(
      `width=${bounds.width},height=${bounds.height},left=${bounds.left},top=${bounds.top}`,
    );
    expect(popup.resizeTo).toHaveBeenCalledWith(bounds.width, bounds.height);
    expect(popup.focus).toHaveBeenCalledTimes(2);
  });
  it('returns to the dock when the popout closes and closes it on teardown', () => {
    expect.hasAssertions();
    act(() => {
      player.open();
    });
    act(() => {
      handlers.load();
      handlers.pagehide();
    });
    expect(player.container).toBeNull();
    act(() => {
      player.open();
    });
    act(() => {
      player.close();
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(player.container).toBeNull();
  });
  it('reports a blocked popout without leaving a disconnected player view', () => {
    expect.hasAssertions();
    window.open.mockReturnValue(null);
    let opened;
    act(() => {
      opened = player.open();
    });
    expect(opened).toBe(false);
    expect(player.container).toBeNull();
  });
});

describe('player display sizing', () => {
  it('fills the available work area of the current display, including negative monitor coordinates', () => {
    expect.hasAssertions();
    expect(
      playerWindowBounds({
        screen: {
          availWidth: 2_560,
          availHeight: 1_392,
          availLeft: -2_560,
          availTop: 48,
          width: 2_560,
          height: 1_440,
        },
      }),
    ).toEqual({ width: 2_560, height: 1_392, left: -2_560, top: 48 });
  });
  it('uses the detected display or browser size when available-work-area values are missing', () => {
    expect.hasAssertions();
    expect(
      playerWindowBounds({
        screen: { availWidth: 0, availHeight: 0, width: 1_920, height: 1_080 },
        screenX: 30,
        screenY: 10,
      }),
    ).toEqual({ width: 1_920, height: 1_080, left: 30, top: 10 });
    expect(
      playerWindowBounds({
        outerWidth: 1_440,
        outerHeight: 900,
        innerWidth: 1_400,
        innerHeight: 820,
      }),
    ).toEqual({ width: 1_440, height: 900, left: 0, top: 0 });
  });
});
