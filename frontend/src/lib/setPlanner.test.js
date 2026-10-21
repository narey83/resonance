/* The matrix deliberately checks supported and unsupported timing. */
/* eslint-disable jest/no-conditional-expect, jest/no-conditional-in-test */
import library from './__fixtures__/mixLibrary.json';
import {
  makeSetTrack,
  savedSet,
  setData,
  setTracks,
} from './__fixtures__/setPlannerData';
import api from './api';
import {
  appendSetTracks,
  archiveSet,
  getSets,
  insertSetTrack,
  moveSetTrack,
  plannedMasters,
  removeSetTrack,
  saveSet,
  setOverview,
  setRequest,
  validSet,
} from './setPlanner';

jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));

describe('portable Set Planner responses', () => {
  it('keeps first-track master semantics when the API omits null fields', async () => {
    expect.hasAssertions();
    const response = {
      ...savedSet,
      items: [{ path: '/library/Opener.mp3', note: '' }],
    };
    delete response.initialMasterBpm;
    api.get.mockResolvedValue({ data: { scope: 'account', sets: [response] } });
    api.post.mockResolvedValue({ data: response });
    api.put.mockResolvedValue({ data: response });
    expect((await getSets()).sets[0].initialMasterBpm).toBeNull();
    expect((await saveSet(savedSet)).items[0].masterBpm).toBeNull();
    expect((await archiveSet(savedSet, true)).initialMasterBpm).toBeNull();
  });
});

describe('DJ set order and tempo planning', () => {
  it('adds tracks once in source order, keeps notes and does not mutate the saved set', () => {
    expect.hasAssertions();
    const next = appendSetTracks(savedSet, [
      setTracks[1].track,
      setTracks[2].track,
      setTracks[2].track,
    ]);
    expect(next.items.map((row) => row.path)).toEqual(
      setTracks.map(({ track }) => track.path),
    );
    expect(savedSet.items).toHaveLength(2);
    expect(next.items[0]).toEqual(savedSet.items[0]);
    expect(
      appendSetTracks(savedSet, [setTracks[0].track, setTracks[1].track]),
    ).toBe(savedSet);
  });
  it('keeps one first-track or custom master across the entire set, ignoring legacy checkpoints', () => {
    expect.hasAssertions();
    const plan = appendSetTracks(savedSet, [setTracks[2].track]);
    expect(plannedMasters(plan, setData)).toEqual([120, 120, 120]);
    expect(
      plannedMasters(
        {
          ...plan,
          items: plan.items.map((item, i) =>
            i === 1 ? { ...item, masterBpm: 126 } : item,
          ),
        },
        setData,
      ),
    ).toEqual([120, 120, 120]);
    expect(plannedMasters({ ...plan, initialMasterBpm: 125 }, setData)).toEqual(
      [125, 125, 125],
    );
  });
  it('reanchors first-track master on reorder while keeping the other track notes', () => {
    expect.hasAssertions();
    const plan = {
      ...savedSet,
      items: [
        savedSet.items[0],
        { ...savedSet.items[1], note: 'Bass swap', masterBpm: 126 },
      ],
    };
    const next = moveSetTrack(plan, 1, 0);
    expect(next.items[0]).toEqual({ ...plan.items[1], masterBpm: null });
    expect(plannedMasters(next, setData)).toEqual([128, 128]);
    expect(plan.items[1].masterBpm).toBe(126);
    expect(moveSetTrack(plan, -1, 0)).toBe(plan);
  });
  it('removes references without touching the library and inserts dropped tracks at the chosen position', () => {
    expect.hasAssertions();
    expect(
      removeSetTrack(savedSet, savedSet.items[0].path).items.map(
        (item) => item.path,
      ),
    ).toEqual([savedSet.items[1].path]);
    expect(
      insertSetTrack(savedSet, setTracks[2].track, 1).items.map(
        (item) => item.path,
      ),
    ).toEqual([
      setTracks[0].track.path,
      setTracks[2].track.path,
      setTracks[1].track.path,
    ]);
    expect(insertSetTrack(savedSet, setTracks[0].track, 1)).toBe(savedSet);
  });
  it('does not reorder the last track when an external drop exceeds the 200-track limit', () => {
    expect.hasAssertions();
    const full = {
      ...savedSet,
      items: Array.from({ length: 200 }, (_, i) => ({
        path: `track-${i}.mp3`,
        masterBpm: null,
        note: '',
      })),
    };
    expect(appendSetTracks(full, [{ path: 'new.mp3' }]).items).toHaveLength(
      200,
    );
    expect(insertSetTrack(full, { path: 'new.mp3' }, 0)).toBe(full);
  });
  it('counts overlapping handovers once when estimating a set', () => {
    expect.hasAssertions();
    const tracks = ['a', 'b', 'c'].map((name) => makeSetTrack(name));
    const plan = {
      ...savedSet,
      items: tracks.map(({ track }) => ({ path: track.path, masterBpm: null })),
    };
    const overview = setOverview(
      plan,
      Object.fromEntries(tracks.map((data) => [data.track.path, data])),
    );
    expect(overview.knownMusic).toBe(720);
    expect(overview.total).toBe(656);
    expect(overview.rows.map((row) => row.start)).toEqual([0, 208, 416]);
    expect(overview.provisional).toBe(false);
  });
  it('never introduces a tempo ramp when reopening legacy checkpoint sets', () => {
    expect.hasAssertions();
    const tracks = ['a', 'b', 'c'].map((name) => makeSetTrack(name));
    const plan = {
      ...savedSet,
      extendedTempo: true,
      items: tracks.map(({ track }, i) => ({
        path: track.path,
        masterBpm: i === 1 ? 132 : null,
      })),
    };
    const overview = setOverview(
      plan,
      Object.fromEntries(tracks.map((data) => [data.track.path, data])),
    );
    expect(
      overview.transitions.map((row) => row.comparison.master.target),
    ).toEqual([120, 120]);
    expect(overview.total).toBeCloseTo(656);
  });
  it('keeps missing timing, voice and key evidence explicit', () => {
    expect.hasAssertions();
    const overview = setOverview(savedSet, {
      [savedSet.items[0].path]: setTracks[0],
      [savedSet.items[1].path]: {
        track: { ...setTracks[1].track, bpm: null, key: null, genre: null },
        enhanced: { available: false },
      },
    });
    expect(overview.provisional).toBe(true);
    expect(overview.transitions[0].synced.available).toBe(false);
    expect(
      overview.transitions[0].messages.map((message) => message.text),
    ).toEqual(
      expect.arrayContaining([
        'Tempo unknown',
        'Key unknown',
        'Vocal analysis unavailable',
      ]),
    );
    expect(overview.transitions[0].comparison.voiceKnown).toBe(false);
    expect(setOverview(savedSet, {}).unknownDurations).toBe(2);
  });
  it('reports vocal and harmonic clashes without rearranging the set', () => {
    expect.hasAssertions();
    const a = makeSetTrack('a');
    const b = makeSetTrack('b');
    a.enhanced.singing = [{ startSeconds: 0, endSeconds: 240 }];
    b.enhanced.singing = [{ startSeconds: 0, endSeconds: 240 }];
    b.track.key = 'F#';
    b.track.lufs = -5;
    const plan = {
      ...savedSet,
      items: [a, b].map(({ track }) => ({ path: track.path })),
    };
    const overview = setOverview(plan, {
      [a.track.path]: a,
      [b.track.path]: b,
    });
    expect(overview.attention).toBe(1);
    expect(
      overview.transitions[0].messages.map((message) => message.text),
    ).toEqual(
      expect.arrayContaining([
        'Key contrast',
        '~32.0s predicted vocal overlap',
        '+5.0 LU level change',
      ]),
    );
    expect(plan.items.map((item) => item.path)).toEqual([
      a.track.path,
      b.track.path,
    ]);
  });
  it('serializes only portable plan fields and rejects control characters in names', () => {
    expect.hasAssertions();
    expect(setRequest({ ...savedSet, sig: 'temporary', updatedAt: 1 })).toEqual(
      {
        name: 'Test set',
        items: savedSet.items,
        initialMasterBpm: null,
        bars: 16,
        extendedTempo: false,
        notes: '',
        revision: 1,
      },
    );
    expect(validSet({ name: 'Late-night set' })).toBe(true);
    expect(validSet({ name: 'Bad\nname' })).toBe(false);
    expect(validSet({ name: '' })).toBe(false);
  });
  it('checks 630 directional 15-track plans without changing source metadata or accepting unsupported timing', () => {
    expect.hasAssertions();
    const original = JSON.stringify(library);
    let cases = 0;
    for (const a of library)
      for (const b of library) {
        if (a.track.path === b.track.path) continue;
        for (const bars of [8, 16, 32]) {
          const plan = {
            ...savedSet,
            bars,
            items: [a, b].map(({ track }) => ({
              path: track.path,
              masterBpm: null,
            })),
          };
          const overview = setOverview(plan, {
            [a.track.path]: a,
            [b.track.path]: b,
          });
          const transition = overview.transitions[0];
          expect(transition.comparison.master.target).toBe(a.track.bpm);
          expect(transition.comparison.plan.exit.end).toBe(
            a.enhanced.downbeats.at(-1),
          );
          expect(transition.comparison.plan.entry.start).toBe(
            b.enhanced.downbeats[0],
          );
          expect(Number.isFinite(overview.total)).toBe(true);
          expect(overview.total).toBeGreaterThan(0);
          if (!transition.synced.available)
            expect(
              transition.messages.some(
                (message) => message.kind === 'attention',
              ),
            ).toBe(true);
          cases++;
        }
      }

    expect(cases).toBe(630);
    expect(JSON.stringify(library)).toBe(original);
  });
});
