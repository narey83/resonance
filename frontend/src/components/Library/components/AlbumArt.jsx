import { getArtworkUrl } from '../../../lib/musicLibrary';
import React, { useCallback, useEffect, useState } from 'react';

const SESSION_FAIL_KEY = 'resonance-artwork-fail-paths';

const loadFailPaths = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_FAIL_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const artworkFailCache = loadFailPaths();

const persistFailPath = (key) => {
  artworkFailCache.add(key);
  try {
    sessionStorage.setItem(
      SESSION_FAIL_KEY,
      JSON.stringify([...artworkFailCache]),
    );
  } catch {
    /* ignore */
  }
};

const stringToHsl = (nameInput) => {
  let hash = 0;
  for (let charIndex = 0; charIndex < (nameInput?.length ?? 0); charIndex++) {
    hash =
      ((nameInput.codePointAt(charIndex) ?? 0) + hash * 31) % 2_147_483_647;
  }

  const hue = hash % 360;
  return `hsl(${hue}, 55%, 40%)`;
};

const stringToHsl2 = (nameInput) => {
  let hash = 17;
  for (let charIndex = 0; charIndex < (nameInput?.length ?? 0); charIndex++) {
    hash =
      ((nameInput.codePointAt(charIndex) ?? 0) + hash * 31) % 2_147_483_647;
  }

  const hue = (hash + 60) % 360;
  return `hsl(${hue}, 50%, 32%)`;
};

const extractDominantColour = (imgElement) => {
  try {
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.drawImage(imgElement, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;

    let bestSat = -1;
    let bestH = 0;
    let bestL = 0;

    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      const delta = max - min;
      if (delta === 0 || lightness < 0.08 || lightness > 0.92) continue;
      const saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (saturation > bestSat) {
        bestSat = saturation;
        const sector =
          max === r
            ? ((g - b) / delta + 6) % 6
            : max === g
              ? (b - r) / delta + 2
              : (r - g) / delta + 4;
        bestH = Math.round(sector * 60);
        bestL = lightness;
      }
    }

    if (bestSat < 0) return null;
    const clampedLightness = Math.min(0.45, Math.max(0.25, bestL));
    return `hsl(${bestH}, ${Math.round(bestSat * 80)}%, ${Math.round(clampedLightness * 100)}%)`;
  } catch {
    return null;
  }
};

const AlbumArt = ({
  className = '',
  hasArtwork,
  name = '',
  onColour,
  path,
  radius = 6,
  size = 48,
  src: sourceOverride,
  style = {},
}) => {
  const imgSource = sourceOverride ?? getArtworkUrl(path);
  const cacheKey = path || sourceOverride || '';
  const [imgError, setImgError] = useState(() =>
    artworkFailCache.has(cacheKey),
  );

  useEffect(() => {
    setImgError(artworkFailCache.has(cacheKey));
  }, [cacheKey]);

  const handleLoad = useCallback(
    ({ currentTarget }) => {
      if (!onColour) return;
      const colour = extractDominantColour(currentTarget);
      if (colour) onColour(colour);
    },
    [onColour],
  );

  const handleError = useCallback(() => {
    persistFailPath(cacheKey);
    setImgError(true);
  }, [cacheKey]);

  const showImage = hasArtwork && (sourceOverride || path) && !imgError;
  const label = name ? name.charAt(0).toUpperCase() : '?';
  const c1 = stringToHsl(name);
  const c2 = stringToHsl2(name);

  // Gradient + letter always render immediately; image overlays once loaded.
  return (
    <div
      className={`album-art${showImage ? '' : ' album-art--fallback'} ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: radius,
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        color: 'rgba(255,255,255,0.85)',
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        userSelect: 'none',
        ...style,
      }}
    >
      {label}
      {showImage && (
        <img
          alt={name}
          crossOrigin="anonymous"
          loading="lazy"
          onError={handleError}
          onLoad={handleLoad}
          src={imgSource}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
    </div>
  );
};

export default AlbumArt;
