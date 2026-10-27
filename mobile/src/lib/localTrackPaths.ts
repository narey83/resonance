import { Paths } from 'expo-file-system';
import type { MusicTrack } from '../api/musicLibrary';

/** iOS may relocate the app container while preserving Documents and its saved metadata. */
export function restoreImportedTrack(track: MusicTrack): MusicTrack {
  const marker = '/Documents/resonance-local-music/';
  const at = track.path.indexOf(marker);
  if (!track.path.startsWith('file://') || at < 0) return track;
  const filename = track.path.slice(at + marker.length);
  if (!filename || /[\\/]/.test(decodeURIComponent(filename)) || ['.', '..'].includes(decodeURIComponent(filename))) return track;
  const directory = `${Paths.document.uri.replace(/\/$/, '')}/resonance-local-music`;
  const path = `${directory}/${filename}`;
  return { ...track, path, directory: decodeURIComponent(directory.slice(7)) };
}
