const CSHARP_EPOCH_TICKS = 621_355_968_000_000_000;
const NEW_LIBRARY_ITEM_AGE_MS = 7 * 86_400_000;

export const isRecentlyIndexed = (ticks?: number | null, now = Date.now()): boolean => {
  if (!ticks || !Number.isFinite(ticks)) return false;
  const age = now - (ticks - CSHARP_EPOCH_TICKS) / 10_000;
  return age >= 0 && age < NEW_LIBRARY_ITEM_AGE_MS;
};
