// Action feedback is delivered to the notification centre, without popup toasts.
const listeners = new Set();

export const subscribeNotices = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const messageText = (message) => {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  if (message === null || message === undefined) return 'No details available';
  if (typeof message === 'object') return JSON.stringify(message);
  return String(message);
};

const publish = (type) => (message) => {
  const data = { message: messageText(message) };
  for (const listener of listeners) listener(type, data);
};

// Keep the existing action callers' severity API while changing delivery.
export const toast = {
  success: publish('ActionSuccess'),
  info: publish('ActionInfo'),
  warn: publish('ActionWarning'),
  error: publish('ActionError'),
};
