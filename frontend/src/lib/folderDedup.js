const BRACKET_CONTENT = /[([][^)\]]*[)\]]/g; // [FLAC], (1979), [CD Rip], etc.
const BARE_YEAR = /\b(?:19|20)\d{2}\b/g;
const SEPARATORS = /[._-]+/g;
const SPACES = /\s+/g;

// If the last path segment already has an "Artist - Album" style separator we use
// it alone; otherwise we prepend the parent segment (likely the Artist folder) so
// that "Artist/Album [FLAC]" and "Artist - Album (1979)" both normalise the same way.
const getRawAlbumText = (folderPath) => {
  const segments = folderPath.replaceAll('\\', '/').split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';
  if (!last) return '';
  const hasArtistSeparator = / - |_-_/u.test(last);
  if (hasArtistSeparator) return last;
  const parent = segments.at(-2) ?? '';
  return parent ? `${parent} ${last}` : last;
};

export const normalizeFolder = (folderPath) => {
  const raw = getRawAlbumText(folderPath);
  if (!raw) return '';
  return raw
    .replaceAll(BRACKET_CONTENT, '')
    .replaceAll(BARE_YEAR, '')
    .replaceAll(SEPARATORS, ' ')
    .replaceAll(SPACES, ' ')
    .trim()
    .toLowerCase();
};

// Groups folder objects (each requiring .directory and .label strings, plus .bestSpeed and
// .hasFreeSlot booleans) by normalized folder name.
// Returns array of { normalizedName, displayName, folders, bestSpeed, hasFreeSlot }
// sorted by source count desc, then bestSpeed desc.
export const groupFoldersByName = (folderGroups) => {
  const map = new Map();

  for (const folder of folderGroups) {
    const key = normalizeFolder(folder.directory) || folder.directory;

    if (!map.has(key)) {
      map.set(key, {
        normalizedName: key,
        displayName: folder.label,
        folders: [],
        bestSpeed: 0,
        hasFreeSlot: false,
      });
    }

    const group = map.get(key);
    group.folders.push(folder);

    if (folder.bestSpeed > group.bestSpeed) {
      group.bestSpeed = folder.bestSpeed;
      group.displayName = folder.label;
    }

    if (folder.hasFreeSlot) group.hasFreeSlot = true;
  }

  return [...map.values()].sort((a, b) =>
    b.folders.length !== a.folders.length
      ? b.folders.length - a.folders.length
      : b.bestSpeed - a.bestSpeed,
  );
};
