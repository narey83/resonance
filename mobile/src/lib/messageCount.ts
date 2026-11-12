export function messageCount(privateUnread: number, roomUnread: number): number {
  const safe = (count: number) => Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return safe(privateUnread) + safe(roomUnread);
}

export function messageCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
