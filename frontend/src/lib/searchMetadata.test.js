// <copyright file="searchMetadata.test.js" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import * as meta from './searchMetadata';

describe('getArtist / getPathDepth', () => {
  it('extracts artist from a standard Artist/Album (Year)/Track.ext path', () => {
    expect(
      meta.getArtist('Pink Floyd/The Wall (1979)/01 - In the Flesh.flac'),
    ).toBe('Pink Floyd');
  });

  it('returns empty string for single-segment "Artist - Album [FLAC]" folders', () => {
    expect(meta.getArtist('Pink Floyd - The Wall [FLAC]/01 - Track.flac')).toBe(
      '',
    );
  });

  it('returns empty string for flat/shallow shares with no artist segment', () => {
    expect(meta.getArtist('Track.mp3')).toBe('');
    expect(meta.getArtist('SomeFolder/Track.mp3')).toBe('');
  });

  it('handles backslash-separated Windows paths', () => {
    expect(
      meta.getArtist('C:\\Music\\Pink Floyd\\The Wall\\01 Track.flac'),
    ).toBe('Pink Floyd');
  });

  it('extracts artist from an "Artist - Title" filename even with no artist folder (flat compilation shares)', () => {
    expect(
      meta.getArtist(
        'Beatport Top 100 Downloads January 2026/Rhodes, CamelPhat, ARTBAT - For a Feeling (Extended).flac',
      ),
    ).toBe('Rhodes, CamelPhat, ARTBAT');
  });

  it('strips a leading track number before splitting artist/title', () => {
    expect(
      meta.getArtist(
        'Beatport Top 100/58. Rhodes, CamelPhat, ARTBAT - For a Feeling (Remix - Extended).flac',
      ),
    ).toBe('Rhodes, CamelPhat, ARTBAT');
  });

  it('does not treat a plain track number as an artist', () => {
    expect(meta.getArtist('Some Album/01 - Track Name.mp3')).toBe('');
  });
});

describe('getTitle', () => {
  it('strips the extension from the filename', () => {
    expect(meta.getTitle('/a/b/Track Name.mp3')).toBe('Track Name');
  });

  it('handles filenames with multiple dots', () => {
    expect(meta.getTitle('/a/b/Track.Name.v2.flac')).toBe('Track.Name.v2');
  });

  it('returns the full name when there is no extension', () => {
    expect(meta.getTitle('/a/b/README')).toBe('README');
  });

  it('strips a leading track number', () => {
    expect(meta.getTitle('/a/b/01 - Track Name.mp3')).toBe('Track Name');
  });

  it('splits only on the artist/title boundary, keeping parenthetical dashes in the title', () => {
    expect(
      meta.getTitle(
        '/a/b/Rhodes, CamelPhat, ARTBAT - For a Feeling (Remix - Extended).flac',
      ),
    ).toBe('For a Feeling (Remix - Extended)');
  });
});

describe('getExtension', () => {
  it('returns the lowercase extension', () => {
    expect(meta.getExtension('/a/b/Track.FLAC')).toBe('flac');
  });

  it('returns extensions for non-audio file types', () => {
    expect(meta.getExtension('/a/b/cover.jpg')).toBe('jpg');
    expect(meta.getExtension('/a/b/archive.zip')).toBe('zip');
    expect(meta.getExtension('/a/b/video.mkv')).toBe('mkv');
  });

  it('returns an empty string when there is no extension', () => {
    expect(meta.getExtension('/a/b/README')).toBe('');
  });

  it('strips a "@sitename" watermark suffix appended after the real extension', () => {
    expect(meta.getExtension('/a/b/Track.mp3@synoresource')).toBe('mp3');
  });

  it('rejects non-extension text after the last dot', () => {
    expect(
      meta.getExtension('/a/b/Beatport Vol. 06 MB)-(10F)-(TRANCE)-(2010)'),
    ).toBe('');
    expect(meta.getExtension('/a/b/Mark Knight & Wolfgang Gartner')).toBe('');
  });
});

describe('getYear', () => {
  it('finds a year in the folder path over the filename', () => {
    expect(meta.getYear('Artist/Album (1994)/Track.mp3')).toBe('1994');
  });

  it('finds a year in a single-segment "Artist - Album (Year)" folder', () => {
    expect(
      meta.getYear('Pink Floyd - The Wall (1979) [FLAC]/01 Track.flac'),
    ).toBe('1979');
  });

  it('falls back to the filename when the folder has no year', () => {
    expect(meta.getYear('Artist/Album/Track (1994 Remaster).mp3')).toBe('1994');
  });

  it('returns an empty string when no year is parseable anywhere', () => {
    expect(meta.getYear('Artist/Best Of/Track.mp3')).toBe('');
  });

  it('does not match 4-digit numbers outside the 19xx/20xx range', () => {
    expect(meta.getYear('Artist/Album/Track 3000.mp3')).toBe('');
  });
});

describe('extractMetadata', () => {
  it('composes all fields from a single path', () => {
    expect(
      meta.extractMetadata('Pink Floyd/The Wall (1979)/01 - In the Flesh.flac'),
    ).toEqual({
      _artist: 'Pink Floyd',
      _extension: 'flac',
      _title: 'In the Flesh',
      _year: '1979',
    });
  });
});

describe('matchesMetaFilters', () => {
  const file = {
    _artist: 'Pink Floyd',
    _directory: 'Pink Floyd/The Wall (1979)',
    _title: '01 - In the Flesh',
    _year: '1979',
  };

  it('passes everything through when all fields are empty', () => {
    expect(meta.matchesMetaFilters(file, {})).toBe(true);
  });

  it('matches case-insensitively on substrings for artist/title/folder', () => {
    expect(meta.matchesMetaFilters(file, { artist: 'pink' })).toBe(true);
    expect(meta.matchesMetaFilters(file, { title: 'in the flesh' })).toBe(true);
    expect(meta.matchesMetaFilters(file, { folder: 'the wall' })).toBe(true);
  });

  it('matches year by exact equality', () => {
    expect(meta.matchesMetaFilters(file, { year: '1979' })).toBe(true);
    expect(meta.matchesMetaFilters(file, { year: '97' })).toBe(false);
  });

  it('requires all non-empty fields to match (AND semantics)', () => {
    expect(
      meta.matchesMetaFilters(file, { artist: 'pink', title: 'nope' }),
    ).toBe(false);
  });

  it('rejects when any single field fails to match', () => {
    expect(meta.matchesMetaFilters(file, { artist: 'led zeppelin' })).toBe(
      false,
    );
  });
});
