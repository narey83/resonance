// <copyright file="useVisibilityAwarePolling.test.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import { useVisibilityAwarePolling } from './useVisibilityAwarePolling';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

const setDocumentHidden = (hidden) => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
};

const goHidden = () => {
  act(() => {
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

const goVisible = () => {
  act(() => {
    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

const Probe = ({ callback, enabled = true, intervalMs = 1_000 }) => {
  useVisibilityAwarePolling(callback, intervalMs, enabled);
  return null;
};

describe('useVisibilityAwarePolling', () => {
  let container;
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    setDocumentHidden(false);
    setIntervalSpy = jest.spyOn(window, 'setInterval');
    clearIntervalSpy = jest.spyOn(window, 'clearInterval');
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });

  it('calls back on the configured interval while visible', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={callback} />, container);
    });
    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('stops calling back while the tab is hidden', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={callback} />, container);
    });
    goHidden();
    callback.mockClear();
    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('fires exactly one immediate catch-up call on becoming visible, then resumes on the interval', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={callback} />, container);
    });
    goHidden();
    callback.mockClear();

    goVisible();
    expect(callback).toHaveBeenCalledTimes(1); // the catch-up call, not a regular tick

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(2); // the interval resumed normally after that
  });

  // The specific concern this guards against: naively "skip the work but keep the interval
  // running" (what the code used to do) or restarting a fresh interval on every visibility event
  // without stopping the old one would both leave more than one timer alive. Asserting the
  // clearInterval count matches the number of hide transitions -- not just that callbacks look
  // right -- is what actually proves there's never more than one live timer.
  it('never leaves more than one interval running through repeated visibility changes', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={callback} />, container);
    });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    goHidden();
    goVisible();
    goHidden();
    goVisible();

    expect(setIntervalSpy).toHaveBeenCalledTimes(3); // initial start + 2 resumes
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2); // exactly one stop per hide

    // every clearInterval call must have matched a still-running timer -- if a duplicate had ever
    // been created, some interval id would never have been cleared and ticks would over-fire.
    callback.mockClear();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does nothing when not enabled', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(
        <Probe
          callback={callback}
          enabled={false}
        />,
        container,
      );
    });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(callback).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('clears its interval on unmount', () => {
    const callback = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={callback} />, container);
    });
    clearIntervalSpy.mockClear();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest callback, even though index.jsx recreates it every render', () => {
    const first = jest.fn();
    const second = jest.fn();

    act(() => {
      ReactDOM.render(<Probe callback={first} />, container);
    });
    act(() => {
      ReactDOM.render(<Probe callback={second} />, container);
    });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // and, critically, re-rendering with a new callback must not itself create a second timer
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
