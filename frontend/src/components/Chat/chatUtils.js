import { parseUtcDate } from '../../lib/util';

const AVATAR_COLORS = [
  '#5c6bc0',
  '#26a69a',
  '#ef5350',
  '#42a5f5',
  '#ab47bc',
  '#66bb6a',
  '#e67e22',
  '#29b6f6',
  '#ec407a',
  '#8d6e63',
];

export const avatarColor = (username = '') => {
  let hash = 0;
  for (const char of username) hash = (char.codePointAt(0) ?? 0) + hash * 31;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export const avatarInitial = (username = '') =>
  (username[0] || '?').toUpperCase();

export const formatTime = (timestamp) =>
  parseUtcDate(timestamp).toLocaleTimeString('en', {
    hour: 'numeric',
    minute: '2-digit',
  });

export const formatDateLabel = (timestamp) => {
  const date = parseUtcDate(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(Number(today) - 86_400_000);
  const messageDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  if (Number(messageDay) === Number(today)) return 'Today';
  if (Number(messageDay) === Number(yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const groupByDate = (messages) => {
  const groups = [];
  let currentLabel = null;
  for (const message of messages) {
    const label = formatDateLabel(message.timestamp);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, messages: [] });
    }

    groups[groups.length - 1].messages.push(message);
  }

  return groups;
};
