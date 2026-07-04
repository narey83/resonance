const target = new EventTarget();

export const emitPrivateMessage = (detail) => {
  target.dispatchEvent(new CustomEvent('private-message', { detail }));
};

export const onPrivateMessage = (handler) => {
  const listener = (e) => handler(e.detail);
  target.addEventListener('private-message', listener);
  return () => target.removeEventListener('private-message', listener);
};
