import type { MusicAlbum } from '../api/musicLibrary';

/** A directory can contain several releases, so always retain the album filter. */
export function albumTrackParams(album: MusicAlbum): Record<string, string | number> {
  return {
    album: album.album,
    ...(album.directory ? { folder: album.directory } : { artist: album.artist }),
    sort: 'track',
  };
}
