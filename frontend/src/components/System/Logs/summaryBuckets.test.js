import { summaryBuckets } from './summaryBuckets';

describe('hourly summaries', () => {
  it('aggregates contexts and severities, preserves UTC and fills missing hours', () => {
    const result = summaryBuckets([
      { hour: '2026-10-25 01:00:00', level: 'Information', count: 3 },
      { hour: '2026-10-25T01:00:00Z', level: 'Information', count: 4 },
      { hour: '2026-10-25T03:00:00', level: 'Fatal', count: 2 },
      { hour: '2026-10-25T03:00:00', level: 'Warning', count: 1 },
      { hour: 'invalid', level: 'Error', count: 10 },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].routine).toBe(7);
    expect(result[1]).toMatchObject({ routine: 0, warning: 0, error: 0 });
    expect(result[2]).toMatchObject({ routine: 0, warning: 1, error: 2 });
    expect(result[0].hour).toBe(Date.parse('2026-10-25T01:00:00Z'));
  });

  it('empty and invalid counts do not invent activity', () => {
    expect(summaryBuckets()).toEqual([]);
    expect(
      summaryBuckets([{ hour: '2026-10-25T00:00:00', count: -1 }]),
    ).toEqual([]);
  });
});
