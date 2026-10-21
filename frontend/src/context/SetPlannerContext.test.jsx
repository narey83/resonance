import { savedSet } from '../lib/__fixtures__/setPlannerData';
import { archiveSet, getSets, saveSet } from '../lib/setPlanner';
import { SetPlannerProvider, useSetPlanner } from './SetPlannerContext';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../lib/setPlanner', () => ({
  ...jest.requireActual('../lib/setPlanner'),
  getSets: jest.fn(),
  saveSet: jest.fn(),
  archiveSet: jest.fn(),
}));
let current;
const Probe = () => {
  current = useSetPlanner();
  return <div>{current.draft?.name}</div>;
};

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

describe('saved set drafts', () => {
  let container;
  const mount = async () => {
    await act(async () => {
      ReactDOM.render(
        <SetPlannerProvider>
          <Probe />
        </SetPlannerProvider>,
        container,
      );
    });
    await act(async () => {
      await current.activate();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sessionStorage.clear();
    getSets.mockResolvedValue({ scope: 'alice', sets: [savedSet] });
    saveSet.mockImplementation(async (plan, copy) => ({
      ...plan,
      id: copy ? 'copy' : plan.id || 'new',
      revision: copy ? 1 : plan.revision + 1,
    }));
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(async () => {
    await act(async () => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });
  it('serializes rapid edits using the revision returned by the previous save', async () => {
    expect.hasAssertions();
    await mount();
    const pending = deferred();
    saveSet.mockImplementationOnce(() => pending.promise);
    act(() => current.edit({ name: 'First edit' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    act(() => current.edit({ notes: 'New edit while request is pending' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(saveSet).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({ ...savedSet, name: 'First edit', revision: 2 }),
    );
    expect(saveSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        notes: 'New edit while request is pending',
        revision: 2,
      }),
    );
    expect(current.draft.revision).toBe(3);
    expect(current.dirty).toBe(false);
    expect(
      sessionStorage.getItem('resonance-set-planner-draft:alice'),
    ).toBeNull();
  });
  it('retains an offline edit and recovers it for the same account on remount', async () => {
    expect.hasAssertions();
    await mount();
    saveSet.mockRejectedValueOnce(new Error('Offline'));
    act(() => current.edit({ notes: 'Keep this draft' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(current.dirty).toBe(true);
    expect(
      JSON.parse(sessionStorage.getItem('resonance-set-planner-draft:alice'))
        .notes,
    ).toBe('Keep this draft');
    await act(async () => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await mount();
    expect(current.draft.notes).toBe('Keep this draft');
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(current.dirty).toBe(false);
  });
  it('never recovers another account’s draft', async () => {
    expect.hasAssertions();
    sessionStorage.setItem(
      'resonance-set-planner-draft:alice',
      JSON.stringify({ ...savedSet, name: 'Private Alice draft' }),
    );
    getSets.mockResolvedValue({ scope: 'bob', sets: [] });
    await mount();
    expect(current.draft.name).toBe('Untitled set');
    expect(current.draft.items).toEqual([]);
    expect(current.dirty).toBe(false);
  });
  it('keeps a conflicting draft and can save a new copy without overwriting the other window', async () => {
    expect.hasAssertions();
    await mount();
    saveSet.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Changed in another window' } },
    });
    act(() => current.edit({ name: 'My conflicting order' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(current.error).toContain('another window');
    expect(current.dirty).toBe(true);
    await act(async () => {
      await current.copy();
    });
    expect(saveSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'My conflicting order (copy)' }),
      true,
    );
    expect(current.draft.id).toBe('copy');
    expect(current.dirty).toBe(false);
  });
  it('can correct an invalid name after a failed autosave without getting stuck on a rejected promise', async () => {
    expect.hasAssertions();
    await mount();
    act(() => current.edit({ name: '' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(current.error).toContain('visible characters');
    expect(saveSet).not.toHaveBeenCalled();
    act(() => current.edit({ name: 'Corrected set' }));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(current.draft.name).toBe('Corrected set');
    expect(current.dirty).toBe(false);
  });
  it('saves before switching sets and keeps edits locked during archive/restore actions', async () => {
    expect.hasAssertions();
    const other = { ...savedSet, id: 'other', name: 'Other set' };
    getSets.mockResolvedValue({ scope: 'alice', sets: [savedSet, other] });
    await mount();
    act(() => current.edit({ notes: 'Save before leaving' }));
    await act(async () => {
      await current.select('other');
    });
    expect(saveSet).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Save before leaving' }),
    );
    expect(current.draft.id).toBe('other');
    const pending = deferred();
    archiveSet.mockImplementationOnce(() => pending.promise);
    let operation;
    await act(async () => {
      operation = current.archive(other, true);
    });
    expect(current.switching).toBe(true);
    act(() => current.edit({ name: 'Do not edit a set being archived' }));
    expect(current.draft.name).toBe('Other set');
    await act(async () => {
      pending.resolve({ ...other, revision: 2, archived: true });
      await operation;
    });
    expect(current.switching).toBe(false);
    expect(current.draft.id).toBe(savedSet.id);
  });
  it('flushes the final edit when navigating out of the library before its debounce expires', async () => {
    expect.hasAssertions();
    await mount();
    act(() => current.edit({ notes: 'Last edit before navigation' }));
    await act(async () => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(saveSet).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Last edit before navigation' }),
    );
  });
});
