import { getTracks, type MusicAlbum, type MusicTrack } from '../api/musicLibrary';
import { resolveTracks } from '../api/discovery';
import { albumTrackParams, belongsToAlbum } from '../lib/albumTracks';
import { sessionGuard } from '../lib/sessionScope';

/** Fetch the selected album identity, including when several artists share its title/folder. */
export async function getAlbumTracks(album: MusicAlbum, limit = 200): Promise<MusicTrack[]> {
  const current = sessionGuard();
  if (album.trackCount === 1 && album.coverPath) {
    const resolved = await resolveTracks([album.coverPath]);
    if (!current()) throw new Error('Session changed');
    const track = resolved.find(track => belongsToAlbum(track, album));
    if (track) return [track];
  }
  const selected = new Map<string, MusicTrack>();
  let offset = 0;
  do {
    const page = await getTracks({ ...albumTrackParams(album), limit: 200, offset });
    if (!current()) throw new Error('Session changed');
    for (const track of page.tracks) {
      if (belongsToAlbum(track, album)) selected.set(track.path, track);
    }
    offset += page.tracks.length;
    if (!page.tracks.length || offset >= page.total) break;
  } while (selected.size < limit);
  return [...selected.values()].slice(0, limit);
}
