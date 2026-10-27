import * as searches from '../api/searches';
import type { DiggingWish } from '../api/discovery';
import { sessionGuard } from '../lib/sessionScope';

export function newSearchId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
// Recheck a small rotating batch on opening the app, with a daily cooldown. Existing server
// searches supply the durable timestamp, so reinstalling cannot flood Soulseek with searches.
export async function refreshWantedSearches(wishes: DiggingWish[]): Promise<searches.Search[]> {
  const current = sessionGuard();
  const all = await searches.getAll();
  let checked = 0;
  for (const wish of wishes) {
    if (!current() || checked >= 3) break;
    const existing = all.filter(search => search.searchText.toLowerCase() === wish.query.toLowerCase())
      .sort((a, b) => Date.parse(b.lastSearchedAt ?? b.startedAt) - Date.parse(a.lastSearchedAt ?? a.startedAt))[0];
    if (existing && (!existing.isComplete || Date.now() - Date.parse(existing.lastSearchedAt ?? existing.startedAt) < 86400000)) continue;
    checked++;
    if (existing) await searches.restart(existing.id);
    else await searches.create(newSearchId(), wish.query);
  }
  return current() ? searches.getAll() : [];
}
