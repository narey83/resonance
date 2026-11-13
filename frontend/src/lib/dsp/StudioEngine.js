// The worklet is loaded on first use. Until it is ready, the existing player
// graph stays connected directly to the destination so playback cannot stall.
export class StudioEngine {
  constructor(context, input, destination) {
    this.context = context;
    this.input = input;
    this.destination = destination;
    this.direct = context.createGain();
    this.direct.gain.value = 1;
    this.directGuard = context.createWaveShaper();
    const ceiling = 10 ** (-1 / 20);
    this.directGuard.curve = Float32Array.from({ length: 4_097 }, (_, index) =>
      Math.max(-ceiling, Math.min(ceiling, index / 2_048 - 1)),
    );
    input.connect(this.direct);
    this.direct.connect(this.directGuard);
    this.directGuard.connect(destination);
    this.node = null;
    this.wet = null;
    this.loading = null;
    this.active = false;
    this.controls = null;
  }

  configure(controls) {
    this.controls = controls;
    this.node?.port.postMessage({ type: 'configure', controls }, []);
  }

  async setMode(active) {
    this.active = active;
    if (active && !this.node) {
      if (!this.context.audioWorklet || !window.AudioWorkletNode)
        throw new Error(
          'Studio requires AudioWorklet support in this browser.',
        );
      if (!this.loading) {
        // CRA replaces PUBLIC_URL at build time, including nested deployments.
        // eslint-disable-next-line n/no-process-env
        const url = `${process.env.PUBLIC_URL || ''}/studio-worklet.js`;
        this.loading = this.context.audioWorklet
          .addModule(url)
          .then(() => {
            this.node = new window.AudioWorkletNode(
              this.context,
              'resonance-studio',
              {
                outputChannelCount: [2],
                processorOptions: { controls: this.controls },
              },
            );
            this.wet = this.context.createGain();
            this.wet.gain.value = 0;
            this.input.connect(this.node);
            this.node.connect(this.wet);
            this.wet.connect(this.destination);
            if (this.controls) this.configure(this.controls);
          })
          .catch((error) => {
            this.loading = null;
            throw error;
          });
      }

      await this.loading;
    }

    const now = this.context.currentTime;
    this.direct.gain.setTargetAtTime(this.active ? 0 : 1, now, 0.015);
    this.wet?.gain.setTargetAtTime(this.active ? 1 : 0, now, 0.015);
  }
}
