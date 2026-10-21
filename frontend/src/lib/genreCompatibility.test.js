import {
  compareGenres,
  GENRE_GUIDE,
  genreEvidence,
  genreWarning,
} from './genreCompatibility';

describe('reviewed genre relationships', () => {
  it('recognises documented melodic and house/techno relationships', () => {
    expect(
      compareGenres(
        { genre: 'Trance (Main Floor)' },
        { genre: 'Progressive House' },
      ).kind,
    ).toBe('related');
    expect(
      compareGenres({ genre: 'Tech House' }, { genre: 'Techno (Peak Time)' })
        .kind,
    ).toBe('related');
    expect(compareGenres({ genre: 'R&B' }, { genre: 'Hip-Hop' }).kind).toBe(
      'same',
    );
    expect(GENRE_GUIDE.length).toBeGreaterThan(4);
  });
  it('does not treat equal BPM or shared bass history as genre compatibility', () => {
    expect(
      compareGenres(
        { genre: 'Drum & Bass', bpm: 140 },
        { genre: 'Dubstep', bpm: 140 },
      ).kind,
    ).toBe('cross');
    expect(compareGenres({ genre: 'Trance' }, { genre: 'Hip-Hop' }).kind).toBe(
      'cross',
    );
    expect(compareGenres({ genre: 'House' }, { genre: 'Ambient' }).kind).toBe(
      'cross',
    );
  });
  it('uses specific predictions when tags are broad, with their source visible', () => {
    const evidence = genreEvidence({
      genre: 'Electronic',
      djSummary: { genre: 'Techno' },
    });
    expect(evidence.source).toBe('predicted');
    expect(evidence.family.id).toBe('techno');
    expect(compareGenres({ genre: 'Bouncy' }, { genre: 'EDM' }).known).toBe(
      false,
    );
    expect(genreEvidence({ genre: 'Electronic' }).family).toBeNull();
    expect(genreEvidence({ genre: 'Trap' }).family).toBeNull();
    expect(genreEvidence({ genre: 'Garage Rock' }).family).toBeNull();
  });
  it('surfaces tag/prediction disagreement instead of claiming a verified fit', () => {
    const result = compareGenres(
      { genre: 'Electro', djSummary: { genre: 'Trance' } },
      { genre: 'Trance' },
    );
    expect(result.known).toBe(false);
    expect(result.kind).toBe('conflict');
    expect(result.from.tag).toBe('Electro');
    expect(result.from.prediction).toBe('Trance');
  });
  it('warns about a known mismatch in either direction even at matching BPM', () => {
    const trance = { genre: 'Trance', bpm: 140 };
    const hiphop = { genre: 'Hip-Hop', bpm: 140 };
    const forward = genreWarning(compareGenres(trance, hiphop));
    const reverse = genreWarning(compareGenres(hiphop, trance));
    expect(forward.kind).toBe('mismatch');
    expect(reverse.kind).toBe('mismatch');
    expect(forward.detail).toContain('Melodic dance → Song-led / vocal-led');
    expect(forward.detail).toContain('matching BPM alone');
    expect(forward.advice).toContain('short handover');
    expect(genreWarning(compareGenres(trance, { genre: 'Trance' }))).toBeNull();
    expect(
      genreWarning(compareGenres(trance, { genre: 'Progressive House' })),
    ).toBeNull();
  });
  it('keeps missing and contradictory evidence separate from confirmed mismatches', () => {
    expect(
      genreWarning(compareGenres({ genre: 'EDM' }, { genre: 'Trance' })).kind,
    ).toBe('unknown');
    const conflict = compareGenres(
      { genre: 'House', djSummary: { genre: 'Hip-Hop' } },
      { genre: 'Trance' },
    );
    expect(genreWarning(conflict).kind).toBe('conflict');
    expect(genreWarning(conflict).title).toBe('Conflicting genre data');
  });
});
