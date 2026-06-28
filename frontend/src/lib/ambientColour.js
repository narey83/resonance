// ── Ambient art-accent engine ────────────────────────────────────────────────
// Drives the --art-* CSS custom properties from the now-playing artwork so the
// chrome (active nav indicator, player scrubber, glows) takes on the colour of
// whatever is playing. Until set here, those vars fall back to the active theme
// accent — see the "Phase 0 primitives" block in App.css.

const ART_VARS = [
  '--art-accent',
  '--art-accent-hover',
  '--art-accent-rgb',
  '--art-glow',
];

// HSL (h in degrees, s/l in 0..1) → [r, g, b] in 0..255.
const hslToRgb = (h, s, l) => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [chroma, x, 0];
  else if (hp < 2) [r, g, b] = [x, chroma, 0];
  else if (hp < 3) [r, g, b] = [0, chroma, x];
  else if (hp < 4) [r, g, b] = [0, x, chroma];
  else if (hp < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];
  const m = l - chroma / 2;
  return [r, g, b].map((v) => Math.round((v + m) * 255));
};

const setVar = (name, value) =>
  document.documentElement.style.setProperty(name, value);

// Is the active theme's page surface light? Read the resolved body background
// (always an rgb() string) and compute perceived luminance. Lets the accent
// adapt its lightness to whatever theme is active.
const isLightSurface = () => {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const parts = bg.match(/\d+(?:\.\d+)?/g);
    if (!parts || parts.length < 3) return false;
    const [r, g, b] = parts.map(Number);
    // BT.601 luma (integer weights keep the linter's numeric-separator rule happy).
    return (299 * r + 587 * g + 114 * b) / 1_000 / 255 > 0.5;
  } catch {
    return false;
  }
};

// Take the extracted dominant hue and clamp saturation/lightness to a vivid,
// legible accent regardless of how dark or washed-out the source art is. The
// target lightness adapts to the surface — darker on light themes, brighter on
// dark themes — so a near-black or pastel cover can't produce an illegible
// accent and the contrast holds either way.
export const applyAmbientColour = (colour) => {
  if (!colour || typeof colour.h !== 'number') return;

  const h = colour.h;
  const s = Math.min(0.85, Math.max(0.55, colour.s ?? 0.6));
  const light = isLightSurface();
  const accentL = light ? 0.42 : 0.62;
  const hoverL = light ? 0.34 : 0.72;
  const glowAlpha = light ? 0.22 : 0.32;

  const [r, g, b] = hslToRgb(h, s, accentL);
  const [hr, hg, hb] = hslToRgb(h, s, hoverL);

  setVar('--art-accent', `rgb(${r}, ${g}, ${b})`);
  setVar('--art-accent-hover', `rgb(${hr}, ${hg}, ${hb})`);
  setVar('--art-accent-rgb', `${r}, ${g}, ${b}`);
  setVar('--art-glow', `rgba(${r}, ${g}, ${b}, ${glowAlpha})`);
};

// Revert to the active theme accent (playback stopped, or track has no artwork).
export const clearAmbientColour = () => {
  for (const name of ART_VARS) {
    document.documentElement.style.removeProperty(name);
  }
};
