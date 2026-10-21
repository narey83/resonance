import { getLocalStreamUrl } from './files';
import { placeMixChannels } from './mixAudioTimeline';
import { ensureSigned } from './streamSignatures';

const abortError = () => new DOMException('Preview cancelled', 'AbortError');
export const renderMixDeck = async (context, deck, bpm, signal, progress) => {
  if (signal.aborted) throw abortError();
  await ensureSigned([deck.path]);
  if (signal.aborted) throw abortError();
  progress('Loading audio');
  const response = await fetch(getLocalStreamUrl(deck.path), {
    signal,
    credentials: 'same-origin',
  });
  if (!response.ok)
    throw new Error('Audio could not load. Refresh the library and try again.');
  const size = Number(response.headers.get('content-length'));
  if (size > 100 * 1_024 * 1_024 || deck.duration > 1_200)
    throw new Error(
      'This preview supports tracks up to 20 minutes and 100 MB.',
    );
  let encoded = await response.arrayBuffer();
  if (encoded.byteLength > 100 * 1_024 * 1_024)
    throw new Error('This track is too large for an in-browser mix preview.');
  if (signal.aborted) throw abortError();
  progress('Decoding audio');
  let decoded = await context.decodeAudioData(encoded);
  encoded = null;
  if (signal.aborted) throw abortError();
  const sampleRate = decoded.sampleRate;
  const clipStart = Math.max(0, deck.start - 0.3);
  const lo = Math.floor(clipStart * sampleRate);
  const hi = Math.min(decoded.length, Math.ceil((deck.end + 0.3) * sampleRate));
  if (decoded.duration + 0.05 < deck.end)
    throw new Error('Saved bar timing extends beyond this audio file.');
  const channels = Array.from(
    { length: Math.min(2, decoded.numberOfChannels) },
    (_, i) => decoded.getChannelData(i).slice(lo, hi),
  );
  decoded = null;
  progress('Locking bars and preserving pitch');
  const { createMixWorker } = await import('./mixStretchWorkerFactory');
  if (signal.aborted) throw abortError();
  const rendered = await new Promise((resolve, reject) => {
    const worker = createMixWorker();
    const abort = () => {
      worker.terminate();
      reject(abortError());
    };

    const finish = (callback, value) => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    };

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    worker.onerror = () =>
      finish(
        reject,
        new Error('Audio preparation failed. Try a shorter overlap.'),
      );
    worker.onmessage = ({ data }) =>
      data.error
        ? finish(reject, new Error(data.error))
        : finish(resolve, data.channels);
    worker.postMessage(
      {
        channels,
        sampleRate,
        knots: deck.knots,
        bpm,
        clipStart: lo / sampleRate,
        outputBarOffset: deck.timelineStartBar,
      },
      channels.map((channel) => channel.buffer),
    );
  });
  if (signal.aborted) throw abortError();
  const timeline = placeMixChannels(rendered, sampleRate, deck, bpm);
  const buffer = context.createBuffer(2, timeline[0].length, sampleRate);
  for (const [i, channel] of timeline.entries())
    buffer.copyToChannel(channel, i);
  return buffer;
};
