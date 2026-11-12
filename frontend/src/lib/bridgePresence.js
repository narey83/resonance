import { urlBase } from '../config';

const presenceUrl = 'http://127.0.0.1:55460/api/browser-presence';
const unavailable =
  'Bridge could not be reached on this computer. Start or install Resonance Bridge here, pair it with this Resonance instance, and allow loopback access for this site in your browser.';

export const requireLocalBridge = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(presenceUrl, {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal,
      targetAddressSpace: 'loopback',
    });
  } catch {
    throw new Error(unavailable);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(unavailable);
  let presence;
  try {
    presence = await response.json();
  } catch {
    throw new Error(unavailable);
  }

  if (presence.application !== 'resonance-bridge') throw new Error(unavailable);
  if (!presence.paired)
    throw new Error(
      'Bridge is running here. Pair it with this Resonance instance before transferring the export.',
    );
  let instance;
  try {
    instance = new URL(presence.instance);
  } catch {
    throw new Error(unavailable);
  }

  const expectedPath = urlBase.replace(/\/+$/, '');
  if (
    instance.origin !== window.location.origin ||
    instance.pathname.replace(/\/+$/, '') !== expectedPath
  )
    throw new Error(
      'Bridge on this computer is paired with a different Resonance instance. Pair it with this instance first.',
    );
};
