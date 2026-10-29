// Output-clock telemetry cannot verify sound at the listener's ears.
export const readPlaybackSync = (audio, context, now = performance.now()) => {
  const mediaTime = audio?.currentTime ?? 0;
  const unavailable = {
    available: false,
    delay: 0,
    mediaTime,
    audibleTime: mediaTime,
  };
  if (
    !audio ||
    audio.paused ||
    audio.seeking ||
    audio.readyState < 3 ||
    context?.state !== 'running' ||
    !context.getOutputTimestamp
  )
    return unavailable;
  const stamp = context.getOutputTimestamp();
  if (
    !Number.isFinite(stamp.contextTime) ||
    !Number.isFinite(stamp.performanceTime) ||
    stamp.performanceTime <= 0 ||
    now < stamp.performanceTime ||
    now - stamp.performanceTime > 1_000
  )
    return unavailable;
  const delay =
    context.currentTime -
    stamp.contextTime -
    (now - stamp.performanceTime) / 1_000;
  if (!Number.isFinite(delay) || delay < 0 || delay > 2) return unavailable;
  return {
    available: true,
    delay,
    mediaTime,
    audibleTime: Math.max(0, mediaTime - delay * (audio.playbackRate || 1)),
  };
};
