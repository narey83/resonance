// The dry path starts before loudness trim and bypasses every effect.
// Keep the configured rack intact so resuming restores the user's settings.
export class MasterBypass {
  constructor(context, source, destination, bypassed = true) {
    this.context = context;
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.bypassed = bypassed;
    this.listeners = new Set();
    this.dry.gain.value = bypassed ? 1 : 0;
    this.wet.gain.value = bypassed ? 0 : 1;
    source.connect(this.dry);
    this.dry.connect(destination);
    this.wet.connect(destination);
  }

  setBypassed(value) {
    this.bypassed = Boolean(value);
    const now = this.context.currentTime;
    this.dry.gain.setTargetAtTime(this.bypassed ? 1 : 0, now, 0.015);
    this.wet.gain.setTargetAtTime(this.bypassed ? 0 : 1, now, 0.015);
    for (const listener of this.listeners) listener(this.bypassed);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.bypassed);
    return () => this.listeners.delete(listener);
  }
}
