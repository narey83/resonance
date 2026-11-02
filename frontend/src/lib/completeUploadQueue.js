import { getUploadsQueue } from './transfers';

const PAGE_SIZE = 500;
const DETAILS_REFRESH_MS = 30_000;

const recordsFrom = (snapshot) => {
  const records = new Map();
  for (const user of snapshot.transfers) {
    if (user.username !== snapshot.username)
      throw new Error('Unexpected upload recipient');
    for (const directory of user.directories ?? []) {
      for (const file of directory.files ?? []) {
        if (typeof file.id !== 'string' || file.username !== snapshot.username)
          throw new Error('Invalid upload identity');
        records.set(file.id, { directory: directory.directory, file });
      }
    }
  }

  return records;
};

const completeSnapshot = (snapshot, records, detailsLoadedAt) => {
  const directories = new Map();
  for (const record of records.values()) {
    if (!directories.has(record.directory))
      directories.set(record.directory, []);
    directories.get(record.directory).push(record.file);
  }

  return {
    ...snapshot,
    detailsLoadedAt,
    transfers:
      records.size === 0
        ? []
        : [
            {
              username: snapshot.username,
              directories: [...directories].map(([directory, files]) => ({
                directory,
                files,
              })),
            },
          ],
  };
};

// Transport pages are assembled here; the user sees one complete recipient list.
// Polling reuses unchanged membership for 30s and refreshes active progress from
// the leading sample. A changed count, new sampled ID or missing active ID forces
// a complete reload. Nothing is published to the UI until the IDs reconcile.
export const getCompleteUploadsQueue = async ({
  username,
  signal,
  previous,
} = {}) => {
  let first = await getUploadsQueue({
    username,
    page: 0,
    pageSize: PAGE_SIZE,
    signal,
  });
  if (
    previous?.username === first.username &&
    previous.userTotalPending === first.userTotalPending &&
    Date.now() - previous.detailsLoadedAt < DETAILS_REFRESH_MS
  ) {
    const old = recordsFrom(previous);
    const sample = recordsFrom(first);
    const membershipKnown = [...sample.keys()].every((id) => old.has(id));
    const activeKnown = [...old.values()].every(
      ({ file }) =>
        !['InProgress', 'Initializing'].includes(file.state) ||
        sample.has(file.id),
    );
    if (membershipKnown && activeKnown) {
      for (const [id, record] of sample) old.set(id, record);
      return completeSnapshot(first, old, previous.detailsLoadedAt);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const records = recordsFrom(first);
    const pages = Math.ceil(first.userTotalPending / PAGE_SIZE);
    if (pages <= 1 && records.size === first.userTotalPending) {
      return completeSnapshot(first, records, Date.now());
    }

    const controller = new AbortController();
    const abort = controller.abort.bind(controller);
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const targetUsername = first.username;
    let nextPage = 1;
    try {
      const worker = async () => {
        while (nextPage < pages) {
          const page = nextPage++;
          const result = await getUploadsQueue({
            username: targetUsername,
            page,
            pageSize: PAGE_SIZE,
            signal: controller.signal,
          });
          if (result.username !== targetUsername)
            throw new Error('Unexpected upload recipient');
          for (const [id, record] of recordsFrom(result))
            records.set(id, record);
        }
      };

      await Promise.all([worker(), worker()]);
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }

    const latest = await getUploadsQueue({
      username: first.username,
      page: 0,
      pageSize: PAGE_SIZE,
      signal,
    });
    const sample = recordsFrom(latest);
    if (
      latest.userTotalPending === first.userTotalPending &&
      records.size === latest.userTotalPending &&
      [...sample.keys()].every((id) => records.has(id))
    ) {
      for (const [id, record] of sample) records.set(id, record);
      return completeSnapshot(latest, records, Date.now());
    }

    first = latest;
  }

  throw new Error(
    'Upload queue changed while loading the complete list; retrying',
  );
};
