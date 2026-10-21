import { djSummary } from './libraryWorkbench';

export const GENRE_GUIDE_SOURCE =
  'https://blog.pioneerdj.com/djtips/we-uncover-the-mixing-techniques-behind-every-major-genre/';
export const GENRE_GUIDE_REVISION = '2026-10-16';
// These source-reviewed style relationships are a shortlist, not verified
// individual mixes. Shared history (e.g. bass music) alone is not a match.
export const GENRE_GUIDE = [
  {
    styles: 'House / tech house / techno',
    note: 'Related groove-led traditions. Check intensity, hooks and drum feel.',
  },
  {
    styles: 'Trance / progressive house / melodic house & techno',
    note: 'Related melodic traditions. Key, phrasing and overlapping leads matter.',
  },
  {
    styles: 'Hip-hop / R&B',
    note: 'Related song-led mixing approaches. Often use shorter handovers and avoid two lead vocals.',
  },
  {
    styles: 'UK garage / speed garage / 2-step',
    note: 'Related garage styles. Shuffle and swing need checking even at the same BPM.',
  },
  {
    styles: 'Disco / unquantized selections',
    note: 'Live timing can vary. Prefer short blends unless the actual beat timing supports a longer one.',
  },
  {
    styles: 'Drum & bass / dubstep / garage',
    note: 'Shared bass-music lineage, but distinct groove and tempo: NOT an automatic compatibility group.',
  },
  {
    styles: 'Afro house / amapiano',
    note: 'Related scenes, with different tempo and rhythmic space: check both tracks rather than assuming a blend.',
  },
];

const family = (value) => {
  if (typeof value !== 'string') return null;
  const genre = value
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll('-', ' ');
  if (/progressive house|melodic (?:house|techno)/.test(genre))
    return {
      id: 'melodic',
      label: 'Progressive / melodic',
      groove: 'Melodic dance',
    };
  if (/trance/.test(genre))
    return { id: 'trance', label: 'Trance', groove: 'Melodic dance' };
  if (/techno/.test(genre))
    return { id: 'techno', label: 'Techno', groove: 'Groove-led dance' };
  if (/afro house|afro tech/.test(genre))
    return { id: 'afro', label: 'Afro house', groove: 'Polyrhythmic house' };
  if (/amapiano/.test(genre))
    return {
      id: 'amapiano',
      label: 'Amapiano',
      groove: 'Spacious percussion-led dance',
    };
  if (/house/.test(genre))
    return { id: 'house', label: 'House', groove: 'Groove-led dance' };
  if (/drum\s*(?:and|n)\s*bass|dnb|d n b|jungle/.test(genre))
    return { id: 'dnb', label: 'Drum & bass', groove: 'Fast breakbeats' };
  if (/dubstep/.test(genre))
    return { id: 'dubstep', label: 'Dubstep', groove: 'Half-time bass' };
  if (
    /\b(?:uk|speed) garage\b|\b2 step\b|\btwo step\b|\bbassline\b|^garage(?:$|\s*\()/.test(
      genre,
    )
  )
    return {
      id: 'garage',
      label: 'UK garage',
      groove: 'Shuffle / syncopation',
    };
  if (/hip hop|hiphop|\brap\b|r\s*and\s*b|rhythm and blues/.test(genre))
    return {
      id: 'hiphop',
      label: 'Hip-hop / R&B',
      groove: 'Song-led / vocal-led',
    };
  if (/disco|funk/.test(genre))
    return { id: 'disco', label: 'Disco / funk', groove: 'Check live timing' };
  if (/hardcore|hardstyle|hard dance|gabber/.test(genre))
    return {
      id: 'harddance',
      label: 'Hard dance',
      groove: 'Fast / high intensity',
    };
  if (/\belectro\b|\bbreakbeat\b|\bbreaks\b/.test(genre))
    return {
      id: 'breaks',
      label: 'Electro / breaks',
      groove: 'Broken / syncopated beat',
    };
  if (/ambient|classical|experimental/.test(genre))
    return {
      id: 'free',
      label: 'Ambient / free timing',
      groove: 'Beatmatching may not apply',
    };
  if (/pop/.test(genre))
    return { id: 'pop', label: 'Pop', groove: 'Song-led; rhythm varies' };
  return null;
};

export const genreEvidence = (track) => {
  const tag = family(track?.genre);
  const predictionLabel = djSummary(track).genre;
  const prediction = family(predictionLabel);
  const conflict = tag && prediction && tag.id !== prediction.id;
  return {
    family: tag || prediction,
    source: tag ? 'tagged' : prediction ? 'predicted' : 'unknown',
    tag: track?.genre || null,
    prediction: predictionLabel || null,
    conflict: Boolean(conflict),
  };
};

export const compareGenres = (a, b) => {
  const from = genreEvidence(a);
  const to = genreEvidence(b);
  if (from.conflict || to.conflict)
    return {
      known: false,
      kind: 'conflict',
      label: 'Genre disagreement',
      from,
      to,
      detail:
        'A genre tag and prediction disagree. Check the sound before trusting the style match.',
    };
  if (!from.family || !to.family)
    return {
      known: false,
      kind: 'unknown',
      label: 'Genre unclear',
      from,
      to,
      detail:
        'A broad or missing genre does not establish a style relationship.',
    };
  if (from.family.id === to.family.id)
    return {
      known: true,
      kind: 'same',
      label: 'Same genre family',
      from,
      to,
      detail: `Both route to ${from.family.label}. Still compare rhythm, arrangement and intensity.`,
    };
  const pair = [from.family.id, to.family.id].sort().join(':');
  if (
    [
      'house:techno',
      'house:melodic',
      'melodic:techno',
      'melodic:trance',
    ].includes(pair)
  )
    return {
      known: true,
      kind: 'related',
      label: 'Related styles',
      from,
      to,
      detail:
        'A source-reviewed relationship in the genre guide. The particular tracks still need their groove and phrases to fit.',
    };
  return {
    known: true,
    kind: 'cross',
    label: 'Cross-genre transition',
    from,
    to,
    detail:
      'No conservative blend relationship in this guide. Consider a short handover, breakdown or fade.',
  };
};

// A warning describes the evidence and a rehearsal choice, never a ban on a mix.
// Missing/conflicting evidence must not become a definite genre mismatch.
export const genreWarning = (comparison) => {
  if (comparison.kind === 'cross')
    return {
      kind: 'mismatch',
      title: 'Genre mismatch',
      detail: `${comparison.from.family.groove} → ${comparison.to.family.groove}. This pairing is outside the reviewed blend guide; matching BPM alone does not establish a style fit.`,
      advice:
        'Preview a short handover, a breakdown or a fade before committing to a long blend.',
    };
  if (comparison.kind === 'conflict')
    return {
      kind: 'conflict',
      title: 'Conflicting genre data',
      detail:
        'A track’s genre tag and analysis point to different families, so the style relationship is uncertain.',
      advice:
        'Check the tagged and predicted genres below and audition the handover.',
    };
  if (comparison.kind === 'unknown')
    return {
      kind: 'unknown',
      title: 'Genre not confirmed',
      detail:
        'A missing, broad or unrecognised genre prevents a style comparison. This is not a confirmed mismatch.',
      advice:
        'Audition the rhythm and arrangement before relying on a long blend.',
    };
  return null;
};
