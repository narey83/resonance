import { createSearchHubConnection } from '../../lib/hubFactory';
import * as library from '../../lib/searches';
import Searches from './Searches';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/hubFactory', () => ({
  createSearchHubConnection: jest.fn(),
}));
jest.mock('../../lib/hubRetryLoop', () => ({
  createHubRetryLoop: () => ({ start: jest.fn(), dispose: jest.fn() }),
}));
jest.mock('../../lib/searches', () => ({ create: jest.fn() }));
jest.mock('./Detail/SearchDetail', () => ({ search }) => (
  <div>Results for {search.searchText}</div>
));
jest.mock('./List/SearchList', () => 'mock-search-list');
jest.mock('./SearchWizard', () => ({ busy, onSearch }) => (
  <button
    disabled={busy}
    onClick={() =>
      onSearch({ search: 'alice deejay', filters: { flags: ['unlocked'] } })
    }
    type="button"
  >
    {busy ? 'Starting…' : 'Search'}
  </button>
));

describe('search wizard handover', () => {
  let container;
  let handlers;
  let finish;
  beforeEach(() => {
    handlers = {};
    createSearchHubConnection.mockReturnValue({
      on: (name, handler) => {
        handlers[name] = handler;
      },
      off: jest.fn(),
      onreconnecting: jest.fn(),
      onreconnected: jest.fn(),
      onclose: jest.fn(),
      stop: jest.fn(),
    });
    library.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    container = document.createElement('div');
    document.body.append(container);
    act(() => {
      ReactDOM.render(<Searches server={{ isConnected: true }} />, container);
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const start = () =>
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Search',
        ),
      ),
    );
  it('closes on the hub acknowledgement without waiting for HTTP, and late HTTP does not close a new wizard', async () => {
    expect.hasAssertions();
    expect(container.textContent).not.toContain('New search');
    start();
    const { id } = library.create.mock.calls.at(-1)[0];
    const search = { id, searchText: 'alice deejay', state: 'InProgress' };
    act(() => handlers.create(search));
    expect(container.textContent).toContain('Results for alice deejay');
    expect(container.textContent).toContain('New search');
    expect(container.textContent).not.toContain('Starting…');
    act(() =>
      Simulate.click(
        [...container.querySelectorAll('button')].find((button) =>
          button.textContent.includes('New search'),
        ),
      ),
    );
    await act(async () => {
      finish({ data: search });
    });
    expect(container.textContent).not.toContain('Results for alice deejay');
    expect(container.textContent).not.toContain('Starting…');
  });
  it('also closes on a successful HTTP response if the hub event is delayed', async () => {
    expect.hasAssertions();
    start();
    const { id } = library.create.mock.calls.at(-1)[0];
    await act(async () => {
      finish({ data: { id, searchText: 'alice deejay', state: 'InProgress' } });
    });
    expect(container.textContent).toContain('Results for alice deejay');
    expect(container.textContent).not.toContain('Starting…');
  });
});
