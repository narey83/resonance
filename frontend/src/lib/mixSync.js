import { mixDuration, mixPath } from './mixCompatibility';

const finite = Number.isFinite;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const fail = (reason) => ({ available: false, reason });
export const crossfadeGains = (position) => {
  const x = clamp(finite(position) ? position : 0, 0, 1);
  // Equal power, with 3 dB of headroom even for two correlated, full-scale tracks.
  return [
    x === 1 ? 0 : Math.cos((x * Math.PI) / 2) / Math.SQRT2,
    Math.sin((x * Math.PI) / 2) / Math.SQRT2,
  ];
};

export const syncPlan = (a, b, windows, bpm, extended = false) => {
  if (!finite(bpm) || bpm < 20 || bpm > 400)
    return fail('Both tracks need a saved BPM.');
  if (!a?.track || !b?.track || mixPath(a.track) === mixPath(b.track))
    return fail('Choose two different library tracks.');
  const bars = windows?.exit?.bars;
  if (
    ![8, 16, 32].includes(bars) ||
    windows?.entry?.bars !== bars ||
    !windows.exit.aligned ||
    !windows.entry.aligned
  )
    return fail('Both tracks need a saved bar grid for a synced preview.');
  const barDuration = 240 / bpm;
  if (bars * barDuration > 96)
    return fail(
      'Choose a shorter overlap for this tempo (maximum 96 seconds).',
    );
  const limit = extended ? 0.25 : 0.08;
  const decks = [a, b].map((data, i) => {
    const window = i === 0 ? windows.exit : windows.entry;
    const grid = [...new Set(data.enhanced?.downbeats || [])]
      .filter((t) => finite(t) && t >= 0 && t <= mixDuration(data))
      .sort((left, right) => left - right);
    const first = grid.findIndex((t) => Math.abs(t - window.start) < 0.000_001);
    const knots = grid.slice(first, first + bars + 1);
    if (
      knots.length !== bars + 1 ||
      Math.abs(knots[0] - window.start) > 0.001 ||
      Math.abs(knots[bars] - window.end) > 0.001
    )
      return null;
    const rates = knots
      .slice(1)
      .map((end, j) => (end - knots[j]) / barDuration);
    if (
      rates.some(
        (rate) => !finite(rate) || Math.abs(rate - 1) > limit + 0.000_001,
      )
    )
      return null;
    // Add context around the actual handover. Only complete, supported bars
    // are used; an extreme adjacent tempo ramp cannot silently extend it.
    let contextBars = 0;
    while (contextBars < 4) {
      const index =
        i === 0 ? first - contextBars - 1 : first + bars + contextBars;
      if (index < 0 || index + 1 >= grid.length) break;
      const rate = (grid[index + 1] - grid[index]) / barDuration;
      if (Math.abs(rate - 1) > limit + 0.000_001) break;
      contextBars++;
    }

    const segment = grid.slice(
      first - (i === 0 ? contextBars : 0),
      first + bars + (i === 1 ? contextBars : 0) + 1,
    );
    return {
      path: mixPath(data.track),
      knots: segment,
      rates: segment.slice(1).map((end, j) => (end - segment[j]) / barDuration),
      start: segment[0],
      end: segment[segment.length - 1],
      duration: mixDuration(data),
      contextBars,
    };
  });
  if (decks.some((deck) => !deck))
    return fail(
      `Saved bar timing needs a change outside ±${extended ? 25 : 8}%. Choose another pair, shorter overlap, or extend the range.`,
    );
  const leadBars = decks[0].contextBars;
  const tailBars = decks[1].contextBars;
  const handoverStart = leadBars * barDuration;
  const handoverEnd = (leadBars + bars) * barDuration;
  const duration = (leadBars + bars + tailBars) * barDuration;
  return {
    available: true,
    bpm,
    bars,
    leadBars,
    tailBars,
    handoverStart,
    handoverEnd,
    duration,
    decks: decks.map((deck, i) => ({
      ...deck,
      timelineStart: i === 0 ? 0 : handoverStart,
      timelineEnd: i === 0 ? handoverEnd : duration,
      previewDuration: duration,
      timelineStartBar: i === 0 ? 0 : leadBars,
      timelineEndBar: i === 0 ? leadBars + bars : leadBars + bars + tailBars,
      previewBars: leadBars + bars + tailBars,
    })),
  };
};

export const sourcePosition = (deck, elapsed, plan) => {
  const position = clamp(
    ((elapsed - deck.timelineStart) * plan.bpm) / 240,
    0,
    deck.knots.length - 1,
  );
  const bar = Math.min(deck.knots.length - 2, Math.floor(position));
  const fraction = position - bar;
  return deck.knots[bar] + fraction * (deck.knots[bar + 1] - deck.knots[bar]);
};

export const transitionPosition = (elapsed, plan) =>
  clamp(
    (elapsed - plan.handoverStart) / (plan.handoverEnd - plan.handoverStart),
    0,
    1,
  );

// Both rendered stems share one AudioContext, start time, offset and duration.
// B has silence before its entry; A has silence after its exit. AudioParam
// automation performs the handover. UI timers only report progress.
export class SharedMixTransport {
  constructor(context, buffers, plan, onEnded = null) {
    if (
      buffers.length !== 2 ||
      buffers[0].length !== buffers[1].length ||
      buffers[0].sampleRate !== buffers[1].sampleRate
    )
      throw new Error(
        'The two preview stems must share an exact sample timeline.',
      );
    this.context = context;
    this.onEnded = onEnded;
    this.buffers = buffers;
    this.plan = plan;
    this.duration = plan.duration ?? buffers[0].duration;
    this.offset = 0;
    this.playing = false;
    this.generation = 0;
    this.position = 0;
    this.automatic = true;
    this.sources = [];
    this.gains = buffers.map(() => context.createGain());
    this.output = context.createGain();
    this.output.gain.value = 0.8;
    this.output.connect(context.destination);
    this.meters = context.createAnalyser
      ? this.gains.map((gain) => {
          const meter = context.createAnalyser();
          meter.fftSize = 512;
          gain.connect(meter);
          meter.connect(this.output);
          return meter;
        })
      : null;
    this.meterSamples = new Float32Array(512);
    if (!this.meters) for (const gain of this.gains) gain.connect(this.output);
    this.scheduleGains(context.currentTime, 0);
  }

  snapshot() {
    const elapsed = this.playing
      ? Math.max(0, this.context.currentTime - this.startedAt) + this.offset
      : this.offset;
    if (this.playing && elapsed >= this.duration) {
      this.playing = false;
      this.offset = this.duration;
    }

    const levels = this.meters?.map((meter) => {
      if (!this.playing) return -60;
      meter.getFloatTimeDomainData(this.meterSamples);
      const power =
        this.meterSamples.reduce((sum, value) => sum + value * value, 0) /
        this.meterSamples.length;
      return Math.max(
        -60,
        Math.min(0, 10 * Math.log10(Math.max(1e-12, power))),
      );
    });
    return {
      playing: this.playing,
      elapsed: Math.min(this.duration, elapsed),
      duration: this.duration,
      crossfade: this.automatic
        ? transitionPosition(elapsed, this.plan)
        : this.position,
      automatic: this.automatic,
      ...(levels ? { levels } : {}),
    };
  }

  setCrossfade(position) {
    const current = crossfadeGains(this.snapshot().crossfade);
    this.position = clamp(position, 0, 1);
    this.automatic = false;
    for (const [i, value] of crossfadeGains(this.position).entries()) {
      const param = this.gains[i].gain;
      param.cancelScheduledValues(0);
      param.setValueAtTime(current[i], this.context.currentTime);
      param.setTargetAtTime(value, this.context.currentTime, 0.012);
    }
  }

  setAutomatic(automatic) {
    const snapshot = this.snapshot();
    this.position = snapshot.crossfade;
    this.automatic = automatic;
    if (automatic) {
      const delay = this.playing ? 0.02 : 0;
      this.scheduleGains(
        Math.max(this.context.currentTime, this.startedAt || 0) + delay,
        snapshot.elapsed + delay,
        crossfadeGains(snapshot.crossfade),
      );
    } else this.setCrossfade(this.position);
  }

  scheduleGains(when, elapsed, previous = null) {
    const x = this.automatic
      ? transitionPosition(elapsed, this.plan)
      : this.position;
    for (const [i, value] of crossfadeGains(x).entries()) {
      const param = this.gains[i].gain;
      param.cancelScheduledValues(0);
      if (previous && when > this.context.currentTime) {
        param.setValueAtTime(previous[i], this.context.currentTime);
        param.linearRampToValueAtTime(value, when);
      } else param.setValueAtTime(value, when);

      if (!this.automatic || !this.playing || elapsed >= this.plan.handoverEnd)
        continue;
      const from = Math.max(elapsed, this.plan.handoverStart);
      const curve = Float32Array.from(
        { length: 257 },
        (_, index) =>
          crossfadeGains(
            transitionPosition(
              from + ((this.plan.handoverEnd - from) * index) / 256,
              this.plan,
            ),
          )[i],
      );
      param.setValueCurveAtTime(
        curve,
        when + (from - elapsed),
        this.plan.handoverEnd - from,
      );
    }
  }

  setVolume(value) {
    this.output.gain.setTargetAtTime(
      Math.max(0, Math.min(1, value)),
      this.context.currentTime,
      0.012,
    );
  }

  async play() {
    if (this.snapshot().playing) return;
    const generation = ++this.generation;
    await this.context.resume();
    if (generation !== this.generation) return;
    if (this.snapshot().playing) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.clearSources();
    const when = this.context.currentTime + 0.04;
    this.startedAt = when;
    this.playing = true;
    this.scheduleGains(when, this.offset);
    this.sources = this.buffers.map((buffer, i) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gains[i]);
      source.onended = () => {
        // Stopped/replaced sources must never advance a rehearsal. Both
        // buffers end together; only the first natural end reports completion.
        if (
          generation !== this.generation ||
          this.endedGeneration === generation
        )
          return;
        // Native ended events can arrive while currentTime still reports the
        // preceding render quantum. Source ownership is the completion guard;
        // a wall-clock threshold would lose the only completion notification.
        this.endedGeneration = generation;
        this.playing = false;
        this.offset = this.duration;
        this.onEnded?.();
      };

      source.start(when, this.offset);
      return source;
    });
  }

  clearSources() {
    const when = this.context.currentTime;
    for (const source of this.sources) {
      source.onended = null;
      source.stop(when);
      source.disconnect();
    }

    this.sources = [];
  }

  pause() {
    this.offset = this.snapshot().elapsed;
    this.playing = false;
    this.generation++;
    this.clearSources();
    this.scheduleGains(this.context.currentTime, this.offset);
  }

  async seek(seconds) {
    const running = this.snapshot().playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, seconds));
    if (running && this.offset < this.duration) await this.play();
    else this.scheduleGains(this.context.currentTime, this.offset);
  }

  stop() {
    this.pause();
    this.offset = 0;
    this.scheduleGains(this.context.currentTime, 0);
  }

  dispose() {
    this.stop();
    for (const gain of this.gains) gain.disconnect();
    if (this.meters) for (const meter of this.meters) meter.disconnect();
    this.output.disconnect();
    this.buffers = [];
  }
}
