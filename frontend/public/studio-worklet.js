// SPDX-License-Identifier: AGPL-3.0-only
// Browser port of mobile/studio-native/StudioDSP.h and StudioTone.h.
const PI = Math.PI;
const cap = (x, low, high) => Number.isFinite(x) ? Math.max(low, Math.min(high, x)) : low;
const FREQS = [60, 120, 250, 500, 1000, 2500, 6000, 12000];
const SAFE = [.35, .35, .3, .4, .3, 1, .15, .25, .25, .15, .3];

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = [0, 0]; this.x2 = [0, 0]; this.y1 = [0, 0]; this.y2 = [0, 0]; }
  coefficients(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; }
  process(x, c) {
    let y = this.b0 * x + this.b1 * this.x1[c] + this.b2 * this.x2[c] - this.a1 * this.y1[c] - this.a2 * this.y2[c];
    if (!Number.isFinite(y)) { this.x1.fill(0); this.x2.fill(0); this.y1.fill(0); this.y2.fill(0); return 0; }
    if (Math.abs(y) < 1e-20) y = 0;
    this.x2[c] = this.x1[c]; this.x1[c] = x; this.y2[c] = this.y1[c]; this.y1[c] = y;
    return y;
  }
  gain(rate, hz, db, shelf = 0) {
    const angle = 2 * PI * Math.min(hz, rate * .45) / rate;
    const cs = Math.cos(angle), sn = Math.sin(angle), a = 10 ** (db / 40);
    if (!shelf) {
      const alpha = sn / (2 * .85);
      this.coefficients(1 + alpha * a, -2 * cs, 1 - alpha * a, 1 + alpha / a, -2 * cs, 1 - alpha / a);
    } else {
      const root = Math.sqrt(2 * a) * sn;
      if (shelf < 0) this.coefficients(a * ((a + 1) - (a - 1) * cs + root), 2 * a * ((a - 1) - (a + 1) * cs), a * ((a + 1) - (a - 1) * cs - root), (a + 1) + (a - 1) * cs + root, -2 * ((a - 1) + (a + 1) * cs), (a + 1) + (a - 1) * cs - root);
      else this.coefficients(a * ((a + 1) + (a - 1) * cs + root), -2 * a * ((a - 1) + (a + 1) * cs), a * ((a + 1) + (a - 1) * cs - root), (a + 1) - (a - 1) * cs + root, 2 * ((a - 1) - (a + 1) * cs), (a + 1) - (a - 1) * cs - root);
    }
  }
  detector(rate, hz, bandpass) {
    const angle = 2 * PI * Math.min(hz, rate * .4) / rate, cs = Math.cos(angle), alpha = Math.sin(angle) / (2 * Math.SQRT1_2);
    if (bandpass) this.coefficients(alpha, 0, -alpha, 1 + alpha, -2 * cs, 1 - alpha);
    else this.coefficients((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + alpha, -2 * cs, 1 - alpha);
  }
}

class Tone {
  constructor(rate) {
    this.rate = rate; this.eq = FREQS.map(() => new Biquad());
    this.bassFilter = new Biquad(); this.trebleFilter = new Biquad();
    this.bassDetector = new Biquad(); this.trebleDetector = new Biquad();
    this.bassDetector.detector(rate, 180, false); this.trebleDetector.detector(rate, 4500, true);
    this.target = FREQS.map(() => 0); this.current = FREQS.map(() => 0);
    this.bass = 0; this.smooth = 0; this.fullEnvelope = 0; this.bassEnvelope = 0; this.trebleEnvelope = 0;
    this.bassReduction = 0; this.trebleReduction = 0; this.preamp = 1; this.preampTarget = 1;
    this.attack = 1 - Math.exp(-1 / (.01 * rate)); this.release = 1 - Math.exp(-1 / (.18 * rate));
    this.gainSlew = 1 - Math.exp(-32 / (.02 * rate)); this.preampSlew = 1 - Math.exp(-1 / (.02 * rate));
    this.countdown = 0; this.active = false; this.requested = false;
  }
  configure(gains, bass, smooth) {
    let positive = 0; this.requested = false;
    for (let i = 0; i < 8; i++) { this.target[i] = cap(gains[i], -6, 6); positive += Math.max(0, this.target[i]); this.requested ||= this.target[i] !== 0; }
    this.preampTarget = 10 ** (-positive / 20);
    this.bass = cap(bass, 0, 1); this.smooth = cap(smooth, 0, 1);
    this.requested ||= this.bass > 0 || this.smooth > 0;
    if (this.requested) this.active = true;
  }
  update() {
    let settled = !this.requested;
    for (let i = 0; i < 8; i++) {
      this.current[i] += this.gainSlew * (this.target[i] - this.current[i]);
      if (Math.abs(this.current[i]) < 1e-5 && !this.target[i]) this.current[i] = 0;
      settled &&= this.current[i] === 0;
      this.eq[i].gain(this.rate, FREQS[i], this.current[i], i === 0 ? -1 : i === 7 ? 1 : 0);
    }
    const reduction = (envelope, threshold, amount, maximum) => amount > 0 ? Math.min(maximum * amount, Math.max(0, 20 * Math.log10(Math.max(1e-9, envelope) / threshold)) * .6 * amount) : 0;
    this.bassReduction += this.gainSlew * (reduction(this.bassEnvelope, Math.max(.025, this.fullEnvelope * .65), this.bass, 4) - this.bassReduction);
    this.trebleReduction += this.gainSlew * (reduction(this.trebleEnvelope, Math.max(.012, this.fullEnvelope * .3), this.smooth, 3) - this.trebleReduction);
    if (!this.bass && this.bassReduction < 1e-5) this.bassReduction = 0;
    if (!this.smooth && this.trebleReduction < 1e-5) this.trebleReduction = 0;
    this.bassFilter.gain(this.rate, 160, -this.bassReduction); this.trebleFilter.gain(this.rate, 4500, -this.trebleReduction);
    if (settled && !this.bassReduction && !this.trebleReduction && Math.abs(this.preamp - 1) < 1e-5) this.active = false;
  }
  process(left, right) {
    if (!this.active) return [left, right];
    this.preamp += this.preampSlew * (this.preampTarget - this.preamp);
    if (--this.countdown <= 0) { this.update(); this.countdown = 32; }
    const samples = [left * this.preamp, right * this.preamp];
    for (const band of this.eq) { samples[0] = band.process(samples[0], 0); samples[1] = band.process(samples[1], 1); }
    const bassPeak = Math.max(Math.abs(this.bassDetector.process(samples[0], 0)), Math.abs(this.bassDetector.process(samples[1], 1)));
    const treblePeak = Math.max(Math.abs(this.trebleDetector.process(samples[0], 0)), Math.abs(this.trebleDetector.process(samples[1], 1)));
    const follow = (value, prior) => prior + (value - prior) * (value > prior ? this.attack : this.release);
    this.fullEnvelope = follow(Math.max(Math.abs(samples[0]), Math.abs(samples[1])), this.fullEnvelope);
    this.bassEnvelope = follow(bassPeak, this.bassEnvelope); this.trebleEnvelope = follow(treblePeak, this.trebleEnvelope);
    return [this.trebleFilter.process(this.bassFilter.process(samples[0], 0), 0), this.trebleFilter.process(this.bassFilter.process(samples[1], 1), 1)];
  }
}

class ResonanceStudio extends AudioWorkletProcessor {
  constructor(options = {}) {
    super(); this.rate = sampleRate; this.tone = new Tone(sampleRate);
    this.delay = new Float32Array(Math.ceil(sampleRate * .4) * 2 + 4); this.cursor = 0;
    this.p = SAFE.map(() => 0); this.target = SAFE.map(() => 0); this.high = [0, 0]; this.filtered = [0, 0];
    this.monoLow = 0; this.fast = 0; this.slow = 0; this.envelope = 0; this.limiter = 1; this.phase = 0;
    this.rackBlend = 0; this.compareBlend = 0; this.dryPower = 0; this.wetPower = 0;
    const coeff = (hz) => 1 - Math.exp(-2 * PI * hz / sampleRate);
    this.lowCoeff = coeff(140); this.highCoeff = coeff(3500);
    this.fastCoeff = 1 - Math.exp(-1 / (.002 * sampleRate)); this.slowCoeff = 1 - Math.exp(-1 / (.06 * sampleRate));
    this.attackCoeff = 1 - Math.exp(-1 / (.01 * sampleRate)); this.releaseCoeff = 1 - Math.exp(-1 / (.15 * sampleRate));
    this.limiterRelease = 1 - Math.exp(-1 / (.1 * sampleRate)); this.rmsCoeff = 1 - Math.exp(-1 / (.4 * sampleRate));
    this.controls = options.processorOptions?.controls || { values: SAFE.map(() => 0), disabled: SAFE.map(() => false), eq: FREQS.map(() => 0), enabled: false, bypass: false, pushed: false, amount: 1, bassControl: 0, smoothness: 0 };
    this.port.onmessage = ({ data }) => { if (data?.type === 'configure') this.controls = data.controls; };
  }
  read(frames, channel) {
    const length = this.delay.length / 2;
    let position = this.cursor / 2 - frames;
    while (position < 0) position += length;
    const i = Math.floor(position) % length, fraction = position - Math.floor(position);
    return this.delay[i * 2 + channel] * (1 - fraction) + this.delay[((i + 1) % length) * 2 + channel] * fraction;
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output?.[0]) return true;
    const ctl = this.controls, amount = cap(ctl.amount, 0, 1);
    const enabled = ctl.enabled === true, bypass = ctl.bypass === true;
    this.tone.configure(FREQS.map((_, i) => cap(ctl.eq?.[i], -6, 6) * amount), cap(ctl.bassControl, 0, 1) * amount, cap(ctl.smoothness, 0, 1) * amount);
    for (let i = 0; i < SAFE.length; i++) {
      const maximum = ctl.pushed ? 1 : SAFE[i];
      this.target[i] = (ctl.disabled?.[i] ? 0 : cap(ctl.values?.[i], 0, maximum)) * amount;
      this.p[i] = Math.min(this.p[i], maximum);
    }
    const filterCoeff = 1 - Math.exp(-2 * PI * (18000 * .025 ** this.p[10]) / this.rate);
    const leftIn = input?.[0], rightIn = input?.[1] || leftIn;
    const leftOut = output[0], rightOut = output[1];
    for (let n = 0; n < leftOut.length; n++) {
      for (let i = 0; i < SAFE.length; i++) this.p[i] += this.attackCoeff * (this.target[i] - this.p[i]);
      this.rackBlend += this.fastCoeff * ((enabled ? 1 : 0) - this.rackBlend);
      const dryL = cap(leftIn?.[n] || 0, -16, 16), dryR = cap(rightIn?.[n] || 0, -16, 16);
      let left = dryL, right = dryR;
      const level = Math.max(Math.abs(left), Math.abs(right));
      this.fast += (level - this.fast) * this.fastCoeff; this.slow += (level - this.slow) * this.slowCoeff;
      this.envelope += (level - this.envelope) * (level > this.envelope ? this.attackCoeff : this.releaseCoeff);
      if (enabled || this.rackBlend > .00001) {
        [left, right] = this.tone.process(left, right);
        const drive = 1 + this.p[1] * 7;
        const transient = cap(1 + this.p[2] * 3 * (this.fast - this.slow) / Math.max(.1, this.slow), .5, 2.5);
        const compression = Math.max(1, this.envelope / .25) ** (-.65 * this.p[3]);
        const values = [left, right];
        for (let c = 0; c < 2; c++) {
          this.high[c] += this.highCoeff * (values[c] - this.high[c]);
          const treble = values[c] - this.high[c], harmonic = Math.tanh(treble * 4) - treble * 4;
          values[c] += harmonic * this.p[0] * .65;
          const saturated = Math.tanh(values[c] * drive) / Math.sqrt(drive);
          values[c] += (saturated - values[c]) * this.p[1];
          values[c] *= transient * compression;
        }
        let mid = (values[0] + values[1]) * .5, side = (values[0] - values[1]) * .5;
        side *= 1 + this.p[4]; left = mid + side; right = mid - side;
        const compensation = 1 / Math.sqrt(1 + this.p[0] * 1.5 + this.p[1] * 3 + this.p[2] + this.p[4]);
        this.phase += 2 * PI * .7 / this.rate; if (this.phase > 2 * PI) this.phase -= 2 * PI;
        const flutterDelay = (.003 + .002 * Math.sin(this.phase)) * this.rate;
        const processed = [left, right];
        for (let c = 0; c < 2; c++) {
          const delayed = this.read(.28 * this.rate, c), room = this.read((c ? .043 : .031) * this.rate, c), flutter = this.read(flutterDelay, c);
          this.delay[this.cursor + c] = cap(processed[c] + delayed * this.p[7] * .45, -4, 4);
          processed[c] += (flutter - processed[c]) * this.p[6];
          processed[c] = (processed[c] + delayed * this.p[7] + room * this.p[8] * .5) / (1 + this.p[7] + this.p[8] * .5);
          if (this.p[9] > .001) { const steps = 2 ** (16 - 12 * this.p[9]); processed[c] += (Math.round(processed[c] * steps) / steps - processed[c]) * this.p[9]; }
          this.filtered[c] += filterCoeff * (processed[c] - this.filtered[c]);
          processed[c] += (this.filtered[c] - processed[c]) * this.p[10]; processed[c] *= compensation;
        }
        this.monoLow += this.lowCoeff * ((processed[0] - processed[1]) * .5 - this.monoLow);
        left = processed[0] - this.monoLow * this.p[5]; right = processed[1] + this.monoLow * this.p[5];
        this.cursor = (this.cursor + 2) % this.delay.length;
      }
      left = dryL + (left - dryL) * this.rackBlend; right = dryR + (right - dryR) * this.rackBlend;
      this.dryPower += this.rmsCoeff * ((dryL * dryL + dryR * dryR) * .5 - this.dryPower);
      this.wetPower += this.rmsCoeff * ((left * left + right * right) * .5 - this.wetPower);
      const comparison = Math.min(1, Math.sqrt(this.wetPower / Math.max(1e-12, this.dryPower)));
      const wetMatch = Math.min(1, Math.sqrt(this.dryPower / Math.max(1e-12, this.wetPower)));
      if (enabled) { left *= wetMatch; right *= wetMatch; }
      this.compareBlend += this.fastCoeff * ((enabled && bypass ? 1 : 0) - this.compareBlend);
      left += (dryL * comparison - left) * this.compareBlend; right += (dryR * comparison - right) * this.compareBlend;
      const ceiling = .891250938, peak = Math.max(Math.abs(left), Math.abs(right));
      const target = peak > ceiling ? ceiling / peak : 1;
      this.limiter = target < this.limiter ? target : this.limiter + (target - this.limiter) * this.limiterRelease;
      leftOut[n] = cap(left * this.limiter, -ceiling, ceiling);
      if (rightOut) rightOut[n] = cap(right * this.limiter, -ceiling, ceiling);
    }
    return true;
  }
}
registerProcessor('resonance-studio', ResonanceStudio);
