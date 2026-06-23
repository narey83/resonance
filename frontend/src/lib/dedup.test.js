import { findDuplicates } from './dedup';

describe('findDuplicates', () => {
  it('treats a _<DateTime.Ticks> collision suffix as a duplicate of the clean-named track', () => {
    const clean = {
      filename: 'Adrian Lux - Teenage Crime (Nath Jennings Bootleg).mp3',
      size: 9_000_000,
      length: 240,
      bitRate: 320,
    };
    const tick = {
      filename:
        'Adrian Lux - Teenage Crime (Nath Jennings Bootleg)_639167203263122481.mp3',
      size: 8_900_000,
      length: 240,
      bitRate: 256,
    };

    const { kept, definite, probable } = findDuplicates([clean, tick]);

    // the higher-quality clean file is kept, the tick-suffixed one is flagged
    expect(kept).toEqual([clean]);
    expect([...definite, ...probable]).toEqual([tick]);
  });

  it('does not strip a short numeric suffix that is part of the real name', () => {
    const a = { filename: 'Some Mix_2024.mp3', size: 5_000_000, length: 180 };
    const b = { filename: 'Some Mix.mp3', size: 5_000_000, length: 180 };

    // identical size + length still makes these an exact match, so force them apart
    a.length = 181;

    const { kept } = findDuplicates([a, b]);

    // "_2024" is only 4 digits, so the names do not normalize to the same stem
    expect(kept).toEqual([a, b]);
  });
});
