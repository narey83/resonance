import SearchWizard from './SearchWizard';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('guided Soulseek search', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  it('sends one network query and keeps format and slot filters out of the API options', () => {
    const onSearch = jest.fn();
    act(() => {
      ReactDOM.render(
        <SearchWizard
          connected
          onSearch={onSearch}
        />,
        container,
      );
    });
    const input = container.querySelector('input');
    act(() => Simulate.change(input, { target: { value: '  DJ Hell  ' } }));
    const submit = () =>
      act(() => Simulate.submit(container.querySelector('form')));
    submit();
    act(() =>
      Simulate.change(container.querySelector('select'), {
        target: { value: 'FLAC' },
      }),
    );
    submit();
    expect(container.textContent).toContain('DJ Hell');
    expect(onSearch).not.toHaveBeenCalled();
    submit();
    expect(onSearch).toHaveBeenCalledWith({
      search: 'DJ Hell',
      options: { fileLimit: 10_000, searchTimeout: 15_000 },
      filters: { extensions: ['FLAC'], flags: ['unlocked'] },
    });
  });
  it('does not submit while disconnected or without search words', () => {
    const onSearch = jest.fn();
    act(() => {
      ReactDOM.render(
        <SearchWizard
          connected={false}
          onSearch={onSearch}
        />,
        container,
      );
    });
    act(() => Simulate.submit(container.querySelector('form')));
    expect(onSearch).not.toHaveBeenCalled();
    expect(container.querySelector('button').disabled).toBe(true);
  });
  it('allows preparing a query offline but requires connection for the final action', () => {
    const onSearch = jest.fn();
    act(() => {
      ReactDOM.render(
        <SearchWizard
          connected={false}
          onSearch={onSearch}
        />,
        container,
      );
    });
    act(() =>
      Simulate.change(container.querySelector('input'), {
        target: { value: 'techno' },
      }),
    );
    act(() => Simulate.submit(container.querySelector('form')));
    act(() => Simulate.submit(container.querySelector('form')));
    expect(container.textContent).toContain('Ready to explore?');
    act(() => Simulate.submit(container.querySelector('form')));
    expect(onSearch).not.toHaveBeenCalled();
  });
});
