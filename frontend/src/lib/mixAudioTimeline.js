// Place rendered audio on the shared sample timeline. Unused frames stay
// exactly zero: B waits for its entry and A stops at its outgoing boundary.
export const placeMixChannels = (channels, sampleRate, deck, bpm) => {
  const barFrames = (240 * sampleRate) / bpm;
  const start = Math.round(deck.timelineStartBar * barFrames);
  const end = Math.round(deck.timelineEndBar * barFrames);
  const length = Math.round(deck.previewBars * barFrames);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !Number.isInteger(length) ||
    start < 0 ||
    end <= start ||
    end > length ||
    channels.length !== 2 ||
    channels.some((channel) => channel.length !== end - start)
  )
    throw new Error('Prepared audio does not match the transition timeline.');
  return channels.map((channel) => {
    const output = new Float32Array(length);
    output.set(channel, start);
    return output;
  });
};
