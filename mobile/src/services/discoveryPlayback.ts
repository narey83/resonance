import { getTracks, getRecentlyAdded, type MusicAlbum, type MusicTrack } from '../api/musicLibrary';
import { getPlayHistory, type PlayRecord } from '../api/libraryActivity';
import { resolveTracks } from '../api/discovery';
import { getAlbumTracks } from './albumTracks';

interface PlaybackSections {
  current: () => boolean;
  tracks: (tracks: MusicTrack[]) => void;
  albums: (albums: MusicAlbum[]) => void;
  fresh: (tracks: MusicTrack[]) => void;
  history: (plays: PlayRecord[]) => void;
  recent: (tracks: MusicTrack[]) => void;
  libraryError: () => void;
}

// Publish playable sections independently. A slow secondary request must not hide
// tracks that have already arrived, or delay requests for the new albums' tracks.
export async function loadDiscoveryPlayback(sections: PlaybackSections): Promise<void> {
  await Promise.allSettled([
    (async () => {
      try {
        const page = await getTracks({ limit: 100, sort: 'title' });
        if (sections.current()) sections.tracks(page.tracks);
      } catch {
        if (sections.current()) sections.libraryError();
      }
    })(),
    (async () => {
      const albums = await getRecentlyAdded(12);
      if (!sections.current()) return;
      sections.albums(albums);
      const pages = await Promise.allSettled(albums.slice(0, 3).map(album =>
        getAlbumTracks(album, 20)));
      if (sections.current()) sections.fresh([...new Map(pages.flatMap(page =>
        page.status === 'fulfilled' ? page.value : []).map(track => [track.path, track])).values()]);
    })(),
    (async () => {
      const plays = await getPlayHistory(20);
      if (!sections.current()) return;
      sections.history(plays);
      const tracks = await resolveTracks([...new Set(plays.map(play => play.path))]);
      if (sections.current()) sections.recent(tracks);
    })(),
  ]);
}
