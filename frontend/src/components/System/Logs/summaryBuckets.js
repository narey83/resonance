export const summaryBuckets = (rows = []) => {
  const hours = new Map();
  for (const row of rows) {
    const time = Date.parse(
      `${String(row.hour).replace(' ', 'T').replace(/Z$/, '')}Z`,
    );
    const count = Number(row.count);
    if (!Number.isFinite(time) || !Number.isSafeInteger(count) || count < 0)
      continue;
    const hour = Math.floor(time / 3_600_000) * 3_600_000;
    const item = hours.get(hour) || { hour, routine: 0, warning: 0, error: 0 };
    const severity = ['Error', 'Fatal'].includes(row.level)
      ? 'error'
      : row.level === 'Warning'
        ? 'warning'
        : 'routine';
    item[severity] += count;
    hours.set(hour, item);
  }

  const result = [...hours.values()].sort((a, b) => a.hour - b.hour);
  if (!result.length) return result;
  const filled = [];
  for (
    let hour = result[0].hour;
    hour <= result[result.length - 1].hour;
    hour += 3_600_000
  )
    filled.push(hours.get(hour) || { hour, routine: 0, warning: 0, error: 0 });
  return filled;
};
