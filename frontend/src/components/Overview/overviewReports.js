import * as reports from '../../lib/reports';

const task = (key, load) => ({ key, load });

// Request only the visible panel's reports. Direction-specific endpoints that
// are inherently upload/download-only are never used for the opposite view.
export const overviewTasks = ({ direction, end, interval, section, start }) => {
  const params = { direction, end, start };
  const summary = task('summary', (signal) =>
    reports.getSummary({ ...params, includeTimings: false, signal }),
  );
  const histogram = task('histogram', (signal) =>
    reports.getHistogram({ ...params, interval, signal }),
  );
  if (!direction)
    return [
      summary,
      histogram,
      task('social', (signal) =>
        reports.getSocialActivity({ end, start, signal }),
      ),
      task('peers', (signal) =>
        reports.getPeerRetention({ end, start, signal }),
      ),
    ];
  if (section === 'glance') {
    const previousStart = new Date(
      2 * Date.parse(start) - Date.parse(end),
    ).toISOString();
    return [
      summary,
      task('prevSummary', (signal) =>
        reports.getSummary({
          direction,
          includeTimings: false,
          end: start,
          start: previousStart,
          signal,
        }),
      ),
    ];
  }

  if (section === 'activity') return [histogram];
  if (section === 'reliability')
    return [
      summary,
      task('exceptions', (signal) =>
        reports.getExceptionsPareto({ ...params, signal }),
      ),
      direction === 'download'
        ? task('retries', (signal) =>
            reports.getRetryFunnel({ end, start, signal }),
          )
        : task('queueWait', (signal) =>
            reports.getQueueWait({ end, start, signal }),
          ),
    ];
  if (section === 'top')
    return [
      task('leaderboard', (signal) =>
        reports.getLeaderboard({
          ...params,
          limit: 10,
          sortBy: 'TotalBytes',
          signal,
        }),
      ),
      ...(direction === 'upload'
        ? [
            task('directories', (signal) =>
              reports.getDirectories({ end, start, limit: 10, signal }),
            ),
            task('topFiles', (signal) =>
              reports.getTopFiles({ end, start, limit: 10, signal }),
            ),
          ]
        : []),
    ];
  if (section === 'geography' && direction === 'upload')
    return [
      task('geography', (signal) =>
        reports.getGeography({ end, start, limit: 8, signal }),
      ),
    ];
  return [];
};

export const loadOverviewReports = async (
  tasks,
  { signal, onResult, onError, concurrency = 2 },
) => {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < tasks.length) {
      const { key, load } = tasks[next++];
      try {
        const value = await load(signal);
        if (!signal.aborted) onResult(key, value);
      } catch (error) {
        if (!signal.aborted) onError?.(key, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
};
