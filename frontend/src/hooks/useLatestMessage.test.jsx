import useLatestMessage from './useLatestMessage';
import React, { useRef } from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

const frame = () =>
  act(() => {
    jest.advanceTimersByTime(20);
  });

describe('latest chat message visibility', () => {
  let container;
  let observers;
  let originalResize;
  const Harness = ({
    active = 'room',
    count = 1,
    latest,
    loading = false,
    virtualizer,
  }) => {
    const ref = useRef(null);
    useLatestMessage(ref, { active, count, latest, loading, virtualizer });
    return (
      <div ref={ref}>
        <div>{count} messages</div>
      </div>
    );
  };

  const render = (props) =>
    act(() => {
      ReactDOM.render(<Harness {...props} />, container);
    });
  beforeEach(() => {
    jest.useFakeTimers();
    observers = [];
    originalResize = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe() {}

      disconnect() {
        this.disconnected = true;
      }
    };
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    global.ResizeObserver = originalResize;
    jest.useRealTimers();
  });
  it('follows new messages and late content or viewport resizing', () => {
    expect.hasAssertions();
    render({});
    const element = container.firstChild;
    Object.defineProperty(element, 'scrollHeight', {
      value: 1_000,
      configurable: true,
    });
    Object.defineProperty(element, 'clientHeight', { value: 200 });
    frame();
    expect(element.scrollTop).toBe(1_000);
    Object.defineProperty(element, 'scrollHeight', {
      value: 1_300,
      configurable: true,
    });
    act(() => observers.at(-1).callback());
    frame();
    expect(element.scrollTop).toBe(1_300);
    element.scrollTop = 0;
    act(() => {
      element.dispatchEvent(new Event('wheel'));
      element.dispatchEvent(new Event('scroll'));
    });
    act(() => observers.at(-1).callback());
    frame();
    expect(element.scrollTop).toBe(0);
    act(() => observers.at(-1).callback([{ target: element }]));
    frame();
    expect(element.scrollTop).toBe(1_300);
    element.scrollTop = 0;
    act(() => {
      element.dispatchEvent(new Event('wheel'));
      element.dispatchEvent(new Event('scroll'));
    });
    render({ count: 2 });
    frame();
    expect(element.scrollTop).toBe(1_300);
  });
  it('aligns virtual rows after loading and switches conversations with the same count', () => {
    expect.hasAssertions();
    const virtualizer = { scrollToIndex: jest.fn() };
    render({ count: 20, loading: true, virtualizer });
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
    render({ count: 20, virtualizer });
    expect(virtualizer.scrollToIndex).toHaveBeenLastCalledWith(19, {
      align: 'end',
    });
    const previous = observers.at(-1);
    render({ active: 'other', count: 20, virtualizer });
    expect(previous.disconnected).toBe(true);
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(2);
    render({ active: 'other', count: 20, latest: 'new-message', virtualizer });
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(3);
  });
});
