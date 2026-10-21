import { stretchBars } from './mixStretch';
// WorkerGlobalScope.postMessage has no targetOrigin argument.
/* eslint-disable unicorn/require-post-message-target-origin */

self.onmessage = ({ data }) => {
  try {
    const channels = stretchBars(data);
    self.postMessage(
      { channels },
      channels.map((channel) => channel.buffer),
    );
  } catch {
    self.postMessage({
      error:
        'The synced audio could not be prepared. Try another pair or shorter overlap.',
    });
  }
};
/* eslint-enable unicorn/require-post-message-target-origin */
