import { getScanState } from '../lib/analysis';
import { useEffect, useState } from 'react';

let snapshot = {};
let timer;
let running = false;
const listeners = new Set();
const poll = async () => {
  if (running) return;
  running = true;
  try {
    snapshot = await getScanState();
    for (const listener of listeners) listener(snapshot);
  } catch {
    /* A missed poll must not erase the last known status. */
  } finally {
    // Polls are serialised by the synchronous guard above.
    // eslint-disable-next-line require-atomic-updates
    running = false;
    if (listeners.size) timer = setTimeout(poll, 3_000);
  }
};

export default function useAnalysisQueue() {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) poll();
    return () => {
      listeners.delete(setState);
      if (!listeners.size) clearTimeout(timer);
    };
  }, []);
  return state;
}
