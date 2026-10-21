import { useLibraryActivity } from '../context/LibraryActivityContext';
import api from '../lib/api';
import { resolveLibraryTracks } from '../lib/libraryWorkbench';
import { mixPath } from '../lib/mixCompatibility';
import { seedSignatures } from '../lib/streamSignatures';
import useDebounce from './useDebounce';
import { useEffect, useRef, useState } from 'react';

// Only selected set tracks are resolved. Cached enhanced analysis is fetched
// with bounded concurrency; opening the planner never starts analysis jobs.
const useSetPlanAnalysis = (items) => {
  const key = JSON.stringify(items.map((item) => item.path).sort());
  const revision = useDebounce(useLibraryActivity()?.libraryRevision || 0, 600);
  const [data, setData] = useState({});
  const previous = useRef({});
  useEffect(() => {
    const controller = new AbortController();
    const paths = JSON.parse(key);
    const update = (next) => {
      if (!controller.signal.aborted) {
        previous.current = next;
        setData(next);
      }
    };

    update(
      Object.fromEntries(
        paths.map((path) => [
          path,
          { ...previous.current[path], loading: true },
        ]),
      ),
    );
    if (!paths.length) return () => controller.abort();
    void (async () => {
      let records;
      try {
        records = await resolveLibraryTracks(paths);
      } catch {
        update(
          Object.fromEntries(
            paths.map((path) => [
              path,
              {
                ...previous.current[path],
                track: previous.current[path]?.track || { path },
                loading: false,
                error: 'Track details could not refresh.',
              },
            ]),
          ),
        );
        return;
      }

      if (controller.signal.aborted) return;
      seedSignatures(records);
      const byPath = Object.fromEntries(
        records.map((track) => [mixPath(track), track]),
      );
      update(
        Object.fromEntries(
          paths.map((path) => [
            path,
            {
              track: byPath[path],
              enhanced: previous.current[path]?.enhanced,
              loading: Boolean(byPath[path]),
              missing: !byPath[path],
            },
          ]),
        ),
      );
      let index = 0;
      const worker = async () => {
        while (!controller.signal.aborted && index < paths.length) {
          const path = paths[index++];
          if (!byPath[path]) continue;
          try {
            const { data: enhanced } = await api.get(
              '/analysis/candidates/enhanced',
              { params: { path }, signal: controller.signal },
            );
            update({
              ...previous.current,
              [path]: { track: byPath[path], enhanced, loading: false },
            });
          } catch {
            update({
              ...previous.current,
              [path]: {
                track: byPath[path],
                loading: false,
                error: 'Section and vocal analysis could not load.',
              },
            });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, paths.length) }, worker),
      );
    })();

    return () => controller.abort();
  }, [key, revision]);
  return data;
};

export default useSetPlanAnalysis;
