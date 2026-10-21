import useSetPlanAnalysis from '../../../hooks/useSetPlanAnalysis';
import {
  makeSetTrack,
  savedSet,
} from '../../../lib/__fixtures__/setPlannerData';
import SetRehearsal from './SetRehearsal';
import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../hooks/useSetPlanAnalysis', () => jest.fn());
let latest;
let context;
const Preview = ({ onClose, pair, rehearsal }) => {
  latest = rehearsal;
  const events = useRef(rehearsal);
  events.current = rehearsal;
  useEffect(() => () => events.current.onSuspend('disposed'), []);
  useEffect(() => {
    if (rehearsal.playRequest && rehearsal.current.synced.available)
      rehearsal.onStarted();
  }, [rehearsal.playRequest, rehearsal]);
  return (
    <section aria-label="Rehearsal test preview">
      <h2>
        {pair.a.title} → {pair.b.title}
      </h2>
      <span>{rehearsal.current.master} BPM fixed</span>
      {rehearsal.navigation}
      <button
        onClick={() => rehearsal.onComplete({ fullyPlayed: true })}
        type="button"
      >
        Finish naturally
      </button>
      <button
        onClick={() => rehearsal.onComplete({ fullyPlayed: false })}
        type="button"
      >
        Finish partial
      </button>
      <button
        onClick={() =>
          rehearsal.onSettingsChange({ bars: 8, extendedTempo: false })
        }
        type="button"
      >
        Shorter handover
      </button>
      <button
        onClick={onClose}
        type="button"
      >
        Close rehearsal
      </button>
      {rehearsal.footer({
        ready: rehearsal.current.synced.available,
        onPause: () => rehearsal.onSuspend('paused'),
        onPlay: () => {
          rehearsal.contextRef.current ||= context;
          rehearsal.onStarted();
        },
      })}
    </section>
  );
};

const button = (container, name) =>
  [...container.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === name,
  );

describe('full-set rehearsal sequence', () => {
  let container;
  let tracks;
  let plan;
  beforeEach(() => {
    tracks = Array.from({ length: 15 }, (_, i) =>
      makeSetTrack(`Track ${i + 1}`),
    );
    plan = {
      ...savedSet,
      name: 'Booth set',
      items: tracks.map(({ track }, i) => ({
        path: track.path,
        masterBpm: i > 0 ? 145 : null,
      })),
    };
    useSetPlanAnalysis.mockReturnValue(
      Object.fromEntries(tracks.map((row) => [row.track.path, row])),
    );
    context = { state: 'running', close: jest.fn() };
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = () =>
    act(() => {
      ReactDOM.render(
        <SetRehearsal
          Preview={Preview}
          onClose={jest.fn()}
          plan={plan}
        />,
        container,
      );
    });
  it('walks all 14 handovers in order at one master and finishes without wrapping', () => {
    render();
    expect(
      container.querySelectorAll('.set-rehearsal-progress button'),
    ).toHaveLength(14);
    act(() => Simulate.click(button(container, 'Rehearse handover')));
    const finish = () => Simulate.click(button(container, 'Finish naturally'));
    for (let i = 0; i < 14; i++) {
      expect(latest.current.index).toBe(i);
      expect(latest.current.master).toBe(120);
      act(finish);
    }

    expect(latest.current.index).toBe(13);
    expect(
      container.querySelector('.set-rehearsal-summary strong').textContent,
    ).toBe('14 / 14');
    expect(button(container, 'Next handover').disabled).toBe(true);
  });
  it('stops at an unsupported pair and requires an explicit skip', async () => {
    expect.hasAssertions();
    tracks[2] = makeSetTrack('Track 3', 60);
    useSetPlanAnalysis.mockReturnValue(
      Object.fromEntries(tracks.map((row) => [row.track.path, row])),
    );
    render();
    // A native AudioBufferSource end arrives outside React's event batching.
    // Keep that scheduling in this regression check instead of clicking a button.
    const nativeComplete = latest.onComplete;
    await act(async () => {
      await Promise.resolve();
      nativeComplete({ fullyPlayed: true });
    });
    expect(latest.current.index).toBe(1);
    expect(button(container, 'Rehearse handover').disabled).toBe(true);
    expect(
      container.querySelector('.set-rehearsal-status').textContent,
    ).toContain('stopped at handover 2');
    act(() => Simulate.click(button(container, 'Skip handover')));
    expect(latest.current.index).toBe(2);
    expect(
      container.querySelector('.set-rehearsal-summary span').textContent,
    ).toContain('1 skipped');
  });
  it('retains partial progress, pauses progression and ignores callbacks from a previous handover', () => {
    render();
    act(() => Simulate.click(button(container, 'Rehearse handover')));
    const stale = latest;
    act(() => Simulate.click(button(container, 'Next handover')));
    act(() => stale.onComplete({ fullyPlayed: true }));
    expect(latest.current.index).toBe(1);
    expect(
      container.querySelector('.set-rehearsal-summary strong').textContent,
    ).toBe('0 / 14');
    expect(
      container.querySelector('.set-rehearsal-summary span').textContent,
    ).toContain('1 partial');
    act(() =>
      Simulate.change(container.querySelector('[type="checkbox"]'), {
        target: { checked: false },
      }),
    );
    act(() => Simulate.click(button(container, 'Finish partial')));
    expect(latest.current.index).toBe(1);
    expect(
      container.querySelector('.set-rehearsal-summary span').textContent,
    ).toContain('2 partial');
  });
  it('keeps temporary length overrides on return, resets review status and closes its shared context once', () => {
    render();
    act(() => Simulate.click(button(container, 'Rehearse handover')));
    act(() =>
      Simulate.change(container.querySelector('[type="checkbox"]'), {
        target: { checked: false },
      }),
    );
    act(() => Simulate.click(button(container, 'Finish naturally')));
    act(() => Simulate.click(button(container, 'Shorter handover')));
    expect(latest.current.master).toBe(120);
    expect(
      container.querySelector('.set-rehearsal-summary strong').textContent,
    ).toBe('0 / 14');
    act(() => Simulate.click(button(container, 'Next handover')));
    act(() => Simulate.click(button(container, 'Previous handover')));
    expect(latest.current.settings.bars).toBe(8);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
