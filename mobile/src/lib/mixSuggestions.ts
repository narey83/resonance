import type { MusicTrack } from '../api/musicLibrary';

const wheel: Record<string, string> = {
  'abm': '1A', 'g#m': '1A', 'ebm': '2A', 'd#m': '2A', 'bbm': '3A', 'a#m': '3A', 'fm': '4A', 'cm': '5A', 'gm': '6A', 'dm': '7A', 'am': '8A', 'em': '9A', 'bm': '10A', 'f#m': '11A', 'gbm': '11A', 'c#m': '12A', 'dbm': '12A',
  'b': '1B', 'f#': '2B', 'gb': '2B', 'db': '3B', 'c#': '3B', 'ab': '4B', 'g#': '4B', 'eb': '5B', 'd#': '5B', 'bb': '6B', 'a#': '6B', 'f': '7B', 'c': '8B', 'g': '9B', 'd': '10B', 'a': '11B', 'e': '12B',
};
export function camelot(key: string | null): string | null {
  if (!key) return null;
  const value = key.trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  if (/^(?:[1-9]|1[0-2])[ab]$/i.test(value)) return value.toUpperCase();
  return wheel[value.toLowerCase().replace(/\s*(minor|min)$/, 'm').replace(/\s*(major|maj)$/, '').replaceAll(' ', '')] ?? null;
}
export function compatibleKeys(a: string | null, b: string | null): boolean {
  const x = camelot(a), y = camelot(b);
  if (!x || !y) return false;
  const distance = Math.abs(parseInt(x, 10) - parseInt(y, 10));
  return parseInt(x, 10) === parseInt(y, 10) || (x.at(-1) === y.at(-1) && (distance === 1 || distance === 11));
}
export function analysedEnergy(track: MusicTrack): number | null {
  try { const value = JSON.parse(track.djSummary ?? '{}').energy; return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  catch { return null; }
}
export function suggestMixes(source: MusicTrack, tracks: MusicTrack[]) {
  return tracks.filter(track => track.path !== source.path).map(track => {
    const reasons: string[] = [];
    let score = 0;
    if (source.bpm && track.bpm) {
      const delta = Math.abs(track.bpm - source.bpm) / source.bpm;
      if (delta <= .06) { score += 40 * (1 - delta / .08); reasons.push(`${(track.bpm - source.bpm).toFixed(1)} BPM`); }
    }
    if (compatibleKeys(source.key, track.key)) { score += 40; reasons.push(`Compatible key · ${track.key}`); }
    // Loudness is not an energy measurement; only compare actual analysed energy.
    const a = analysedEnergy(source);
    const b = analysedEnergy(track);
    if (a != null && b != null && Math.abs(a - b) <= .15) { score += 15; reasons.push('Similar energy proxy (RMS)'); }
    if (source.genre && track.genre?.toLowerCase() === source.genre.toLowerCase()) { score += 5; reasons.push(source.genre); }
    return { track, score, reasons };
  }).filter(result => result.score >= 15).sort((a, b) => b.score - a.score || a.track.path.localeCompare(b.track.path)).slice(0, 20);
}
