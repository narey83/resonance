import * as rooms from '../../lib/rooms';
import Rooms from './Rooms';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/rooms', () => ({
  getAvailable: jest.fn(),
  getJoined: jest.fn(),
}));
jest.mock('../../lib/translation', () => ({
  getStatus: () => Promise.resolve({}),
}));
jest.mock('../../hooks/useLatestMessage', () => jest.fn());

describe('live room membership', () => {
  let container;
  const render = async (names) => {
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter>
          <Rooms joinedRoomNames={names} />
        </MemoryRouter>,
        container,
      );
    });
  };

  const labels = () =>
    [...container.querySelectorAll('.sr-search-item-text')].map(
      (node) => node.textContent,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    rooms.getJoined.mockReset().mockResolvedValue([]);
    rooms.getAvailable.mockReset().mockResolvedValue([]);
    localStorage.clear();
    sessionStorage.clear();
    container = document.createElement('div');
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    jest.useRealTimers();
  });

  it('applies joins, replacements, and leaving every room without advancing the poll timer', async () => {
    expect.hasAssertions();
    await render();
    await render(['music']);
    expect(labels()).toEqual(['music']);
    const requests = rooms.getJoined.mock.calls.length;
    await render(['music', 'new room']);
    expect(labels()).toEqual(['music', 'new room']);
    await render(['another', 'new room']);
    expect(labels()).toEqual(['another', 'new room']);
    await render([]);
    expect(labels()).toEqual([]);
    expect(rooms.getJoined).toHaveBeenCalledTimes(requests);
  });

  it('does not let an older poll overwrite a live membership update', async () => {
    expect.hasAssertions();
    await render(['music']);
    let resolvePoll;
    rooms.getJoined.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    act(() => jest.advanceTimersByTime(3_000));
    await render(['music', 'new room']);
    await act(async () => resolvePoll(['music']));
    expect(labels()).toEqual(['music', 'new room']);
  });

  it('rejects a pending poll even if membership changes back to its previous names', async () => {
    expect.hasAssertions();
    await render(['music']);
    let resolvePoll;
    rooms.getJoined.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    act(() => jest.advanceTimersByTime(3_000));
    await render(['music', 'temporary']);
    await render(['music']);
    await act(async () => resolvePoll(['music', 'temporary']));
    expect(labels()).toEqual(['music']);
  });

  it('retains polling when live state is unavailable', async () => {
    expect.hasAssertions();
    await render();
    rooms.getJoined.mockResolvedValue(['fallback']);
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(labels()).toEqual(['fallback']);
  });
});
