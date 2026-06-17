import { File } from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function getArtworkCacheKey(trackPath: string, size: number): string {
  return `artwork_${djb2(trackPath)}_${size}`;
}

// Pixel sizes covering 1x–3.5x pixel ratios for layout sizes 36, 42, 48, 96, 512.
const EVICT_SIZES = [36, 42, 48, 72, 84, 96, 105, 108, 120, 126, 144, 147, 168, 288, 512];

export async function evictArtwork(trackPaths: string[]): Promise<void> {
  if (trackPaths.length === 0) return;
  await Promise.all(
    trackPaths.flatMap(path =>
      EVICT_SIZES.map(async size => {
        try {
          const cachePath = await ExpoImage.getCachePathAsync(getArtworkCacheKey(path, size));
          if (cachePath) { const f = new File(cachePath); if (f.exists) f.delete(); }
        } catch {}
      })
    ),
  );
}

export async function clearArtworkCache(): Promise<void> {
  try { await ExpoImage.clearDiskCache(); } catch {}
}
