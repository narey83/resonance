/* The matrix checks both supported and refused saved-grid combinations. */
/* eslint-disable jest/no-conditional-in-test, jest/no-conditional-expect */
import library from './__fixtures__/mixLibrary.json';
import { makeSetTrack, savedSet } from './__fixtures__/setPlannerData';
import {
  rehearsalCounts,
  rehearsalStatus,
  rehearsalTransitions,
} from './setRehearsal';

const makePlan = (tracks, extra = {}) => ({
  ...savedSet,
  ...extra,
  items: tracks.map(({ track }, i) => ({
    path: track.path,
    masterBpm: i > 0 ? 145 : null,
    note: '',
  })),
});
const byPath = (tracks) =>
  Object.fromEntries(tracks.map((row) => [row.track.path, row]));

describe('fixed-tempo full-set rehearsal planning', () => {
  it('uses one master for all 14 handovers and changes length without changing tempo', () => {
    const plan = makePlan(library, { initialMasterBpm: 138 });
    const rows = rehearsalTransitions(plan, byPath(library), {
      3: { bars: 8, extendedTempo: true, masterBpm: 90 },
    });
    expect(rows).toHaveLength(14);
    expect(rows.map((row) => row.master)).toEqual(
      Array.from({ length: 14 }).fill(138),
    );
    expect(rows[3].settings).toEqual({ bars: 8, extendedTempo: true });
    expect(rows[2].settings.bars).toBe(16);
    expect(rows.map((row) => row.a.path)).toEqual(
      plan.items.slice(0, -1).map((item) => item.path),
    );
    expect(rows.map((row) => row.b.path)).toEqual(
      plan.items.slice(1).map((item) => item.path),
    );
  });
  it('does not substitute a later track tempo when the first-track master is unknown', () => {
    const tracks = ['a', 'b', 'c'].map((name) => makeSetTrack(name));
    tracks[0].track.bpm = null;
    const rows = rehearsalTransitions(makePlan(tracks), byPath(tracks));
    expect(rows.map((row) => row.master)).toEqual([null, null]);
    expect(rows.every((row) => !row.synced.available)).toBe(true);
    expect(rows[1].synced.reason).toContain('known master tempo');
    expect(rows[1].messages.map((message) => message.text)).toContain(
      'Tempo unknown',
    );
  });
  it('keeps skipped/partial separate from rehearsed and invalidates changed handover evidence', () => {
    const tracks = ['a', 'b', 'c', 'd'].map((name) => makeSetTrack(name));
    const plan = makePlan(tracks);
    const rows = rehearsalTransitions(plan, byPath(tracks));
    const progress = Object.fromEntries(
      rows.map((row, i) => [
        i,
        {
          signature: row.signature,
          status: ['rehearsed', 'partial', 'skipped'][i],
        },
      ]),
    );
    expect(rehearsalCounts(rows, progress)).toEqual({
      rehearsed: 1,
      partial: 1,
      skipped: 1,
      pending: 0,
      unavailable: 0,
    });
    const changed = rehearsalTransitions(plan, byPath(tracks), {
      0: { bars: 8, extendedTempo: false },
    });
    expect(rehearsalStatus(changed[0], progress)).toBe('pending');
    expect(rehearsalStatus(changed[1], progress)).toBe('partial');
  });
  it('checks every first-track master rotation across all 15 saved tracks and all handover lengths/ranges', () => {
    expect.hasAssertions();
    const original = JSON.stringify(library);
    let cases = 0;
    let supported = 0;
    let refused = 0;
    for (let start = 0; start < library.length; start++) {
      const tracks = [...library.slice(start), ...library.slice(0, start)];
      for (const bars of [8, 16, 32])
        for (const extendedTempo of [false, true]) {
          const rows = rehearsalTransitions(
            makePlan(tracks, { bars, extendedTempo }),
            byPath(tracks),
          );
          for (const row of rows) {
            cases++;
            expect(row.master).toBe(tracks[0].track.bpm);
            if (row.synced.available) {
              supported++;
              const synced = row.synced;
              expect(synced.bpm).toBe(tracks[0].track.bpm);
              expect(synced.bars).toBe(bars);
              expect(synced.handoverEnd - synced.handoverStart).toBeCloseTo(
                (bars * 240) / synced.bpm,
                9,
              );
              expect(synced.decks[0].timelineStart).toBe(0);
              expect(synced.decks[1].timelineStart).toBeCloseTo(
                synced.handoverStart,
                9,
              );
            } else {
              refused++;
              expect(row.synced.reason).toBeTruthy();
            }
          }
        }
    }

    expect(cases).toBe(1_260);
    expect(supported).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(JSON.stringify(library)).toBe(original);
  });
});
