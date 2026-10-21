import {
  archiveSet,
  getSets,
  saveSet,
  setError,
  validSet,
} from '../lib/setPlanner';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const Context = createContext(null);
export const useSetPlanner = () => useContext(Context);
const emptySet = () => ({
  id: null,
  name: 'Untitled set',
  items: [],
  initialMasterBpm: null,
  bars: 16,
  extendedTempo: false,
  notes: '',
  revision: 0,
});
const recoveryKey = (scope) => `resonance-set-planner-draft:${scope}`;
const recover = (scope) => {
  try {
    const draft = JSON.parse(sessionStorage.getItem(recoveryKey(scope)));
    return draft &&
      typeof draft.name === 'string' &&
      Array.isArray(draft.items) &&
      draft.items.length <= 200 &&
      draft.items.every((item) => typeof item.path === 'string')
      ? draft
      : null;
  } catch {
    return null;
  }
};

export const SetPlannerProvider = ({ children }) => {
  const [state, setState] = useState({
    sets: [],
    draft: null,
    loading: false,
    dirty: false,
    saving: false,
    error: '',
    recoveryWarning: false,
    switching: false,
  });
  const owner = useRef({
    ...state,
    active: false,
    mounted: true,
    scope: null,
    timer: null,
    promise: null,
    blocked: false,
    conflict: false,
  });
  const [launch, setLaunch] = useState(null);
  const publish = useCallback((patch) => {
    Object.assign(owner.current, patch);
    if (owner.current.mounted)
      setState((previous) => ({ ...previous, ...patch }));
  }, []);
  const cache = useCallback(() => {
    const current = owner.current;
    if (!current.scope) return;
    try {
      if (current.dirty && current.draft)
        sessionStorage.setItem(
          recoveryKey(current.scope),
          JSON.stringify(current.draft),
        );
      else sessionStorage.removeItem(recoveryKey(current.scope));
      if (current.recoveryWarning) publish({ recoveryWarning: false });
    } catch {
      publish({ recoveryWarning: true });
    }
  }, [publish]);
  const remember = useCallback(
    (saved) => {
      publish({
        sets: [
          saved,
          ...owner.current.sets.filter((set) => set.id !== saved.id),
        ],
      });
    },
    [publish],
  );

  const flush = useCallback(
    async (force = false) => {
      const current = owner.current;
      clearTimeout(current.timer);
      if (current.promise) return current.promise;
      if (!current.draft || (!current.dirty && !(force && !current.draft.id)))
        return current.draft;
      if (current.blocked) throw new Error(current.error);
      if (!validSet(current.draft)) {
        current.blocked = true;
        publish({
          error:
            'Give this set a name of 1–80 visible characters before saving.',
        });
        throw new Error('Give this set a valid name before saving.');
      }

      const run = async () => {
        publish({ saving: true });
        try {
          do {
            const snapshot = current.draft;
            if (!validSet(snapshot))
              throw new Error(
                'Give this set a name of 1–80 visible characters before saving.',
              );
            const saved = await saveSet(snapshot);
            const changed = current.draft !== snapshot;
            remember(saved);
            publish({
              draft: changed
                ? {
                    ...current.draft,
                    id: saved.id,
                    revision: saved.revision,
                    createdAt: saved.createdAt,
                    updatedAt: saved.updatedAt,
                  }
                : saved,
              dirty: changed,
              error: '',
            });
            cache();
          } while (current.dirty);

          return current.draft;
        } catch (error) {
          current.blocked = true;
          current.conflict = error?.response?.status === 409;
          publish({
            error: error?.response
              ? setError(error)
              : error.message || setError(error),
          });
          cache();
          throw error;
        } finally {
          current.promise = null;
          publish({ saving: false });
        }
      };

      current.promise = run();
      return current.promise;
    },
    [cache, publish, remember],
  );

  const edit = useCallback(
    (update) => {
      const current = owner.current;
      if (!current.draft || current.draft.archived || current.switching) return;
      const draft =
        typeof update === 'function'
          ? update(current.draft)
          : { ...current.draft, ...update };
      if (draft === current.draft) return;
      if (!current.conflict) current.blocked = false;
      publish({
        draft,
        dirty: true,
        ...(current.conflict ? {} : { error: '' }),
      });
      cache();
      clearTimeout(current.timer);
      if (!current.blocked)
        current.timer = setTimeout(() => {
          void flush().catch(() => {});
        }, 650);
    },
    [cache, flush, publish],
  );

  const activate = useCallback(async () => {
    const current = owner.current;
    if (current.active) return;
    current.active = true;
    publish({ loading: true });
    try {
      const { scope, sets } = await getSets();
      if (!current.mounted) return;
      current.scope = scope;
      const recovery = recover(scope);
      const saved = sets.find(
        (set) => set.id === recovery?.id && !set.archived,
      );
      const draft =
        recovery && (!recovery.id || saved)
          ? recovery
          : sets.find((set) => !set.archived) || emptySet();
      const dirty = draft === recovery;
      current.conflict = Boolean(
        dirty && saved && saved.revision !== recovery.revision,
      );
      current.blocked = current.conflict;
      publish({
        sets,
        draft,
        dirty,
        error: current.conflict
          ? 'The saved set changed since this recovery draft. Your draft is kept; reload the saved version or save a new copy.'
          : '',
        loading: false,
      });
      if (dirty && !current.conflict)
        current.timer = setTimeout(() => {
          void flush().catch(() => {});
        }, 650);
    } catch {
      current.active = false;
      publish({
        error:
          'Could not load saved sets. Retry when the library is reachable.',
        loading: false,
      });
    }
  }, [flush, publish]);

  const select = useCallback(
    async (id) => {
      await flush();
      const draft = owner.current.sets.find(
        (set) => set.id === id && !set.archived,
      );
      if (draft) {
        publish({ draft, dirty: false, error: '' });
        cache();
      }
    },
    [cache, flush, publish],
  );
  const create = useCallback(async () => {
    await flush();
    publish({ draft: emptySet(), dirty: false, error: '' });
    cache();
  }, [cache, flush, publish]);
  const retry = useCallback(async () => {
    if (owner.current.conflict) throw new Error(owner.current.error);
    owner.current.blocked = false;
    return flush(true);
  }, [flush]);
  const copy = useCallback(async () => {
    const current = owner.current;
    if (current.saving || !current.draft) return;
    const snapshot = current.draft;
    publish({ saving: true });
    try {
      const saved = await saveSet(
        { ...snapshot, name: `${snapshot.name.slice(0, 73)} (copy)` },
        true,
      );
      current.blocked = false;
      current.conflict = false;
      remember(saved);
      publish({
        draft:
          current.draft === snapshot
            ? saved
            : { ...current.draft, id: saved.id, revision: saved.revision },
        dirty: current.draft !== snapshot,
        error: '',
      });
      cache();
    } catch (error) {
      publish({ error: setError(error) });
      throw error;
    } finally {
      publish({ saving: false });
    }
  }, [cache, publish, remember]);
  const reload = useCallback(async () => {
    if (owner.current.saving) return;
    const { sets } = await getSets();
    const draft =
      sets.find((set) => set.id === owner.current.draft?.id && !set.archived) ||
      sets.find((set) => !set.archived) ||
      emptySet();
    // The owner ref is stable; reload deliberately replaces this owner’s draft.
    // eslint-disable-next-line require-atomic-updates
    owner.current.blocked = false;
    // eslint-disable-next-line require-atomic-updates
    owner.current.conflict = false;
    publish({ sets, draft, dirty: false, error: '' });
    cache();
  }, [cache, publish]);
  const archive = useCallback(
    async (plan, archived) => {
      const current = await flush();
      const saved = plan.id === current?.id ? current : plan;
      const result = await archiveSet(saved, archived);
      remember(result);
      if (plan.id === owner.current.draft?.id || !archived) {
        const draft = archived
          ? owner.current.sets.find((set) => !set.archived) || emptySet()
          : result;
        publish({ draft, dirty: false, error: '' });
        cache();
      }
    },
    [cache, flush, publish, remember],
  );
  const consumeLaunch = useCallback(
    (token) =>
      setLaunch((pending) => (pending?.token === token ? null : pending)),
    [],
  );
  const open = useCallback(
    (tracks = []) => {
      setLaunch({ tracks, token: {} });
      void activate();
    },
    [activate],
  );

  useEffect(() => {
    const current = owner.current;
    current.mounted = true;
    const warn = (event) => {
      if (current.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', warn);
    return () => {
      current.mounted = false;
      clearTimeout(current.timer);
      window.removeEventListener('beforeunload', warn);
      if (current.dirty && !current.blocked) void flush().catch(() => {});
    };
  }, [flush]);
  const exclusive = useCallback(
    async (operation) => {
      if (owner.current.switching) return undefined;
      publish({ switching: true });
      try {
        return await operation();
      } finally {
        publish({ switching: false });
      }
    },
    [publish],
  );
  const value = useMemo(
    () => ({
      ...state,
      launch,
      consumeLaunch,
      open,
      activate,
      edit,
      exclusive,
      flush,
      select: (id) => exclusive(() => select(id)),
      create: () => exclusive(create),
      retry,
      copy: () => exclusive(copy),
      reload: () => exclusive(reload),
      archive: (plan, archived) => exclusive(() => archive(plan, archived)),
    }),
    [
      activate,
      archive,
      consumeLaunch,
      copy,
      create,
      edit,
      exclusive,
      flush,
      launch,
      open,
      reload,
      retry,
      select,
      state,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
};
