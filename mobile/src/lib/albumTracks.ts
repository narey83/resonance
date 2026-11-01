import type { MusicAlbum, MusicTrack } from '../api/musicLibrary';

/** A directory can contain several releases, so always retain the album filter. */
export function albumTrackParams(album: MusicAlbum): Record<string, string | number> {
  return {
    album: album.album,
    ...(album.directory ? { folder: album.directory } : { artist: album.artist }),
    sort: 'track',
  };
}

const artistKey = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFC').trim().toLowerCase();

/** Album titles and folders alone cannot distinguish different album artists. */
export function belongsToAlbum(
  track: MusicTrack,
  album: MusicAlbum,
): boolean {
  if (artistKey(track.album) !== artistKey(album.album)) return false;
  const artist = artistKey(album.albumArtist || album.artist);
  if (track.albumArtist?.trim()) return artistKey(track.albumArtist) === artist;
  // Keep untagged compilation performers, but never substitute a different
  // artist for a named release simply because it shares the folder/title.
  return artist === 'various artists' || artistKey(track.artist) === artist;
}
