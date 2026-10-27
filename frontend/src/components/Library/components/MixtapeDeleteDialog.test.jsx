import * as mixtapes from '../../../lib/mixtapes';
import MixtapeDeleteDialog from './MixtapeDeleteDialog';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/mixtapes', () => ({ remove: jest.fn() }));

const dialog = () => document.querySelector('[role="alertdialog"]');
const cancelButton = () => dialog().querySelectorAll('button')[0];
const deleteButton = () => dialog().querySelectorAll('button')[1];
const keyDown = (key, shiftKey = false) => {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }),
  );
};

describe('playlist deletion confirmation', () => {
  let container;
  let previousFocus;
  let onCancel;
  let onDeleted;
  const mixtape = {
    id: 'only-this-mixtape',
    name: 'Test set',
    tracks: [{ filePath: '/music/keep-this.mp3' }],
    isPublished: true,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    container = document.createElement('div');
    previousFocus = document.createElement('button');
    document.body.append(previousFocus, container);
    previousFocus.focus();
    onCancel = jest.fn();
    onDeleted = jest.fn();
    act(() => {
      ReactDOM.render(
        <MixtapeDeleteDialog
          mixtape={mixtape}
          onCancel={onCancel}
          onDeleted={onDeleted}
        />,
        container,
      );
    });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    previousFocus.remove();
  });

  it('explains what is removed and starts focused on Cancel without deleting', () => {
    expect.hasAssertions();
    expect(dialog().textContent).toContain('Test set');
    expect(dialog().textContent).toContain('1 track entry');
    expect(dialog().textContent).toContain(
      'Your original music files will stay in the library.',
    );
    expect(dialog().textContent).toContain(
      'Its shared link will stop working.',
    );
    expect(document.activeElement).toBe(cancelButton());
    expect(mixtapes.remove).not.toHaveBeenCalled();
  });

  it('cancels without sending a deletion request', () => {
    expect.hasAssertions();
    act(() => Simulate.click(cancelButton()));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mixtapes.remove).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('deletes only the confirmed playlist and reports success', async () => {
    expect.hasAssertions();
    mixtapes.remove.mockResolvedValue({});
    await act(async () => Simulate.click(deleteButton()));
    expect(mixtapes.remove).toHaveBeenCalledTimes(1);
    expect(mixtapes.remove).toHaveBeenCalledWith('only-this-mixtape');
    expect(onDeleted).toHaveBeenCalledWith('only-this-mixtape');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('guards duplicate confirmation and dismissal while deletion is pending', async () => {
    expect.hasAssertions();
    let finish;
    mixtapes.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => {
      Simulate.click(deleteButton());
      Simulate.click(deleteButton());
    });
    expect(mixtapes.remove).toHaveBeenCalledTimes(1);
    expect(deleteButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(dialog().getAttribute('aria-busy')).toBe('true');
    act(() => keyDown('Escape'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    await act(async () => finish({}));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('shows a failed request and permits a deliberate retry', async () => {
    expect.hasAssertions();
    mixtapes.remove
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({});
    await act(async () => Simulate.click(deleteButton()));
    expect(dialog().querySelector('[role="alert"]').textContent).toContain(
      'Could not delete this playlist. Please try again.',
    );
    expect(deleteButton().disabled).toBe(false);
    expect(cancelButton().disabled).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
    await act(async () => Simulate.click(deleteButton()));
    expect(mixtapes.remove).toHaveBeenCalledTimes(2);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the dialog and restores its trigger', () => {
    expect.hasAssertions();
    act(() => keyDown('Tab', true));
    expect(document.activeElement).toBe(deleteButton());
    act(() => keyDown('Tab'));
    expect(document.activeElement).toBe(cancelButton());
    act(() => keyDown('Escape'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(document.activeElement).toBe(previousFocus);
  });

  it('ignores a request completing after the dialog has unmounted', async () => {
    expect.hasAssertions();
    let finish;
    mixtapes.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => Simulate.click(deleteButton()));
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await act(async () => finish({}));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });
});
