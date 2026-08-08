// <copyright file="id3Reader.ts" company="John Narey">
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

import * as LegacyFS from 'expo-file-system/legacy';

const CHUNK_SIZE = 256 * 1024; // 256 KB per read

export interface Id3Tags {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  /** 4-digit year, extracted from whatever date/year frame the format provides */
  year: number | null;
  /** Base64 data URL: "data:<mime>;base64,<data>" */
  picture: string | null;
}

// Pulls a plausible 4-digit year out of a year/date tag value — ID3v2.4's TDRC and Vorbis's
// DATE are full timestamps ("2023-05-01T00:00:00"), not just a year, so take the leading digits.
function extractYear(raw: string): number | null {
  const m = raw.match(/\d{4}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1000 && y <= 9999 ? y : null;
}

async function readBytes(uri: string, position: number, length: number): Promise<Uint8Array | null> {
  try {
    const b64 = await LegacyFS.readAsStringAsync(uri, {
      encoding: LegacyFS.EncodingType.Base64,
      position,
      length,
    });
    if (!b64) return null;
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch (e: any) {
    if (_dbgCount <= 4) console.log('[id3] readBytes error:', e?.message ?? String(e), 'pos=', position, 'len=', length);
    return null;
  }
}

// Synchsafe integer (used in ID3v2.4 tag sizes)
function synchsafe(b: Uint8Array, o: number): number {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
}

function be32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function be24(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}

function decodeText(b: Uint8Array, o: number, len: number, enc: number): string {
  const end = o + len;
  if (enc === 1 || enc === 2) {
    // UTF-16 (with or without BOM)
    let i = o;
    if (i + 1 < end && b[i] === 0xff && b[i + 1] === 0xfe) i += 2; // BOM LE
    else if (i + 1 < end && b[i] === 0xfe && b[i + 1] === 0xff) i += 2; // BOM BE
    let s = '';
    while (i + 1 < end) {
      const c = b[i] | (b[i + 1] << 8);
      i += 2;
      if (c === 0) break;
      s += String.fromCodePoint(c);
    }
    return s.trim();
  }
  // enc 0 = Latin-1, enc 3 = UTF-8 (treat both as byte-by-byte for now)
  let s = '';
  for (let i = o; i < end; i++) {
    if (b[i] === 0) break;
    s += String.fromCharCode(b[i]);
  }
  return s.trim();
}

function nullTermEnd(b: Uint8Array, o: number, end: number, wide: boolean): number {
  if (wide) {
    for (let i = o; i + 1 < end; i += 2) {
      if (b[i] === 0 && b[i + 1] === 0) return i + 2;
    }
    return end;
  }
  for (let i = o; i < end; i++) {
    if (b[i] === 0) return i + 1;
  }
  return end;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function parseApic(b: Uint8Array, o: number, size: number, v2: boolean): string | null {
  try {
    const end = o + size;
    const enc = b[o];
    let p = o + 1;
    let mime = '';
    if (v2) {
      // ID3v2.2: 3-char image format
      const fmt = String.fromCharCode(b[p], b[p + 1], b[p + 2]);
      p += 3;
      mime = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
    } else {
      // ID3v2.3/4: null-terminated MIME type
      const mimeEnd = nullTermEnd(b, p, end, false);
      mime = String.fromCharCode(...b.subarray(p, mimeEnd - 1)) || 'image/jpeg';
      p = mimeEnd;
    }
    p++; // picture type byte
    // Skip description (null-terminated, encoding-aware)
    const wide = enc === 1 || enc === 2;
    p = nullTermEnd(b, p, end, wide);
    if (p >= end) return null;
    const imageBytes = b.subarray(p, end);
    return `data:${mime};base64,${uint8ToBase64(imageBytes)}`;
  } catch {
    return null;
  }
}

// ── M4A/MP4 (iTunes atoms) support ───────────────────────────────────────────

async function readM4aTags(
  uri: string,
  first: Uint8Array,
  opts: { title?: boolean; artist?: boolean; album?: boolean; genre?: boolean; year?: boolean; picture?: boolean },
): Promise<Id3Tags> {
  const result: Id3Tags = { title: null, artist: null, album: null, genre: null, year: null, picture: null };

  // Random-access read — prefer bytes already in `first`, else read from file
  const readAt = async (pos: number, len: number): Promise<Uint8Array | null> => {
    if (pos + len <= first.length) return first.subarray(pos, pos + len);
    return readBytes(uri, pos, len);
  };

  // Scan top-level MP4 boxes for 'moov', jumping over large boxes (e.g. mdat) efficiently
  let p = 0;
  let moovPos = -1;
  let moovLen = 0;
  const MAX_SCAN = 64 * 1024 * 1024;

  while (p < MAX_SCAN) {
    const hdr = await readAt(p, 8);
    if (!hdr || hdr.length < 8) break;
    const sz = be32(hdr, 0);
    const ty = String.fromCharCode(hdr[4], hdr[5], hdr[6], hdr[7]);
    if (sz < 8) break;
    if (ty === 'moov') { moovPos = p; moovLen = sz; break; }
    p += sz;
  }

  if (moovPos < 0) return result;

  // Read the moov box (cap at 8 MB for safety — covers any realistic embedded artwork)
  const readLen = Math.min(moovLen, 8 * 1024 * 1024);
  let moov: Uint8Array;

  if (moovPos + readLen <= first.length) {
    moov = first.subarray(moovPos, moovPos + readLen);
  } else {
    const buf = new Uint8Array(readLen);
    let filled = 0;
    while (filled < readLen) {
      const want = Math.min(CHUNK_SIZE, readLen - filled);
      const chunk = await readAt(moovPos + filled, want);
      if (!chunk || chunk.length === 0) break;
      buf.set(chunk, filled);
      filled += chunk.length;
      if (chunk.length < want) break;
    }
    moov = buf.subarray(0, filled);
  }

  // Synchronous child-box search within the buffered moov
  const findChild = (start: number, end: number, type: string): [number, number] | null => {
    let pp = start;
    while (pp + 8 <= end) {
      const sz = be32(moov, pp);
      if (sz < 8 || pp + sz > end) break;
      if (String.fromCharCode(moov[pp+4], moov[pp+5], moov[pp+6], moov[pp+7]) === type)
        return [pp + 8, pp + sz];
      pp += sz;
    }
    return null;
  };

  // Navigate: moov[8..] > udta > meta (+4 version/flags) > ilst
  const moovEnd = moov.length;
  const udta = findChild(8, moovEnd, 'udta');
  if (!udta) return result;
  const meta = findChild(udta[0], udta[1], 'meta');
  if (!meta) return result;
  const ilst = findChild(meta[0] + 4, meta[1], 'ilst');
  if (!ilst) return result;

  const dec = new TextDecoder('utf-8');
  let ip = ilst[0];
  while (ip + 8 <= ilst[1]) {
    const tagSz = be32(moov, ip);
    if (tagSz < 8 || ip + tagSz > ilst[1]) break;
    const tagEnd = ip + tagSz;
    const b0 = moov[ip+4], b1 = moov[ip+5], b2 = moov[ip+6], b3 = moov[ip+7];
    const tagType = String.fromCharCode(b0, b1, b2, b3);

    // Each ilst child contains a 'data' sub-atom
    let dp = ip + 8;
    while (dp + 16 <= tagEnd) {
      const dSz = be32(moov, dp);
      if (dSz < 16 || dp + dSz > tagEnd) break;
      if (String.fromCharCode(moov[dp+4], moov[dp+5], moov[dp+6], moov[dp+7]) === 'data') {
        const typeFlag  = be32(moov, dp + 8); // 1=UTF-8, 13=JPEG, 14=PNG
        const dataStart = dp + 16;            // 8-byte header + 4-byte type + 4-byte locale
        const dataEnd   = dp + dSz;

        if (typeFlag === 1 && dataStart < dataEnd) {
          const text = dec.decode(moov.subarray(dataStart, dataEnd)).trim() || null;
          if (b0 === 0xA9 && text) {
            const k = String.fromCharCode(b1, b2, b3);
            if      (k === 'nam' && opts.title  !== false && !result.title)  result.title  = text;
            else if (k === 'ART' && opts.artist !== false && !result.artist) result.artist = text;
            else if (k === 'alb' && opts.album  !== false && !result.album)  result.album  = text;
            else if (k === 'gen' && opts.genre  !== false && !result.genre)  result.genre  = text;
            else if (k === 'day' && opts.year   !== false && !result.year)   result.year   = extractYear(text);
          }
        } else if ((typeFlag === 13 || typeFlag === 14) && opts.picture && tagType === 'covr' && !result.picture && dataStart < dataEnd) {
          const mime = typeFlag === 14 ? 'image/png' : 'image/jpeg';
          result.picture = `data:${mime};base64,${uint8ToBase64(moov.subarray(dataStart, dataEnd))}`;
        }
        break;
      }
      dp += dSz;
    }
    ip = tagEnd;
  }

  return result;
}

// ── FLAC support ──────────────────────────────────────────────────────────────

function parseFlacPicture(b: Uint8Array, offset: number, length: number): string | null {
  try {
    const end = offset + length;
    let p = offset;
    if (p + 8 > end) return null;
    p += 4; // skip picture type
    const mimeLen = be32(b, p); p += 4;
    if (p + mimeLen > end) return null;
    const mime = String.fromCharCode(...b.subarray(p, p + mimeLen)) || 'image/jpeg';
    p += mimeLen;
    if (p + 4 > end) return null;
    const descLen = be32(b, p); p += 4;
    p += descLen; // skip description
    p += 16;     // skip width + height + color depth + color count
    if (p + 4 > end) return null;
    const dataLen = be32(b, p); p += 4;
    if (p + dataLen > end) return null;
    return `data:${mime};base64,${uint8ToBase64(b.subarray(p, p + dataLen))}`;
  } catch {
    return null;
  }
}

function parseVorbisComments(
  b: Uint8Array, offset: number, length: number, result: Id3Tags,
  opts: { title?: boolean; artist?: boolean; album?: boolean; genre?: boolean; year?: boolean },
): void {
  const end = offset + length;
  let p = offset;
  if (p + 4 > end) return;
  const vendorLen = (b[p] | (b[p+1] << 8) | (b[p+2] << 16) | (b[p+3] << 24)) >>> 0;
  p += 4 + vendorLen;
  if (p + 4 > end) return;
  const count = (b[p] | (b[p+1] << 8) | (b[p+2] << 16) | (b[p+3] << 24)) >>> 0;
  p += 4;
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 4 <= end; i++) {
    const len = (b[p] | (b[p+1] << 8) | (b[p+2] << 16) | (b[p+3] << 24)) >>> 0;
    p += 4;
    if (p + len > end) break;
    const comment = dec.decode(b.subarray(p, p + len));
    p += len;
    const eq = comment.indexOf('=');
    if (eq < 0) continue;
    const key = comment.slice(0, eq).toUpperCase();
    const val = comment.slice(eq + 1).trim() || null;
    if (!val) continue;
    if (key === 'TITLE'  && opts.title  !== false && !result.title)  result.title  = val;
    if (key === 'ARTIST' && opts.artist !== false && !result.artist) result.artist = val;
    if (key === 'ALBUM'  && opts.album  !== false && !result.album)  result.album  = val;
    if (key === 'GENRE'  && opts.genre  !== false && !result.genre)  result.genre  = val;
    if ((key === 'DATE' || key === 'YEAR') && opts.year !== false && !result.year)
      result.year = extractYear(val);
  }
}

async function readFlacTags(
  uri: string,
  first: Uint8Array,
  opts: { title?: boolean; artist?: boolean; album?: boolean; genre?: boolean; year?: boolean; picture?: boolean },
): Promise<Id3Tags> {
  const result: Id3Tags = { title: null, artist: null, album: null, genre: null, year: null, picture: null };
  let buf = first;

  const ensure = async (upTo: number): Promise<boolean> => {
    while (buf.length < upTo) {
      const more = await readBytes(uri, buf.length, CHUNK_SIZE);
      if (!more || more.length === 0) return false;
      const extended = new Uint8Array(buf.length + more.length);
      extended.set(buf);
      extended.set(more, buf.length);
      buf = extended;
      if (more.length < CHUNK_SIZE) break;
    }
    return buf.length >= upTo;
  };

  let p = 4; // skip 'fLaC'
  for (;;) {
    if (!await ensure(p + 4)) break;
    const lastBlock = (buf[p] & 0x80) !== 0;
    const blockType = buf[p] & 0x7F;
    const blockLen = (buf[p+1] << 16) | (buf[p+2] << 8) | buf[p+3];
    p += 4;

    if (blockType === 4) { // VORBIS_COMMENT
      if (await ensure(p + blockLen)) {
        parseVorbisComments(buf, p, blockLen, result, opts);
      }
    } else if (blockType === 6 && opts.picture) { // PICTURE
      if (p + 4 <= buf.length || await ensure(p + 4)) {
        const picType = be32(buf, p);
        // Prefer front cover (type 3); accept any if we haven't got one yet
        if (picType === 3 || !result.picture) {
          if (await ensure(p + blockLen)) {
            const pic = parseFlacPicture(buf, p, blockLen);
            if (pic) result.picture = pic;
            if (picType === 3) { p += blockLen; if (lastBlock) break; continue; }
          }
        }
      }
    }

    p += blockLen;
    if (lastBlock) break;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

let _dbgCount = 0;

export async function readId3Tags(
  uri: string,
  opts: { title?: boolean; artist?: boolean; album?: boolean; genre?: boolean; year?: boolean; picture?: boolean } = {},
): Promise<Id3Tags> {
  const dbg = _dbgCount++ < 3;
  const result: Id3Tags = { title: null, artist: null, album: null, genre: null, year: null, picture: null };

  // Read first chunk — always contains the ID3/FLAC header if one exists
  const first = await readBytes(uri, 0, CHUNK_SIZE);
  if (dbg) console.log('[id3] readBytes result:', first ? `${first.length} bytes, first4=${first[0]},${first[1]},${first[2]},${first[3]}` : 'null', 'uri=', uri.slice(-30));
  if (!first || first.length < 10) return result;

  // FLAC magic: 'fLaC'
  if (first[0] === 0x66 && first[1] === 0x4C && first[2] === 0x61 && first[3] === 0x43) {
    if (dbg) console.log('[id3] FLAC detected');
    return readFlacTags(uri, first, opts);
  }

  // M4A/MP4 magic: 'ftyp' at bytes 4-7 (bytes 0-3 are the variable-length box size)
  if (first.length >= 8 && first[4] === 0x66 && first[5] === 0x74 && first[6] === 0x79 && first[7] === 0x70) {
    if (dbg) console.log('[id3] M4A detected');
    return readM4aTags(uri, first, opts);
  }

  // ID3v2 magic
  if (first[0] !== 0x49 || first[1] !== 0x44 || first[2] !== 0x33) {
    if (dbg) console.log('[id3] no ID3/FLAC magic');
    return result;
  }

  const version = first[3]; // 2, 3, or 4
  const id3BodySize = synchsafe(first, 6);
  const totalId3 = 10 + id3BodySize;

  // Accumulate the full ID3 section
  let id3: Uint8Array;
  if (totalId3 <= first.length) {
    id3 = first.subarray(0, totalId3);
  } else {
    const full = new Uint8Array(totalId3);
    full.set(first);
    let off = first.length;
    while (off < totalId3) {
      const want = Math.min(totalId3 - off, CHUNK_SIZE);
      const chunk = await readBytes(uri, off, want);
      if (!chunk || chunk.length === 0) break;
      full.set(chunk, off);
      off += chunk.length;
      if (chunk.length < want) break;
    }
    id3 = full;
  }

  const v2 = version === 2; // ID3v2.2 uses 3-byte IDs and 3-byte sizes
  const idLen = v2 ? 3 : 4;
  const szLen = v2 ? 3 : 4;
  const flagLen = v2 ? 0 : 2;
  const frameHdr = idLen + szLen + flagLen;

  let pos = 10;
  while (pos + frameHdr <= id3.length) {
    // Frame ID
    if (id3[pos] === 0) break; // padding
    let frameId = '';
    for (let i = 0; i < idLen; i++) frameId += String.fromCharCode(id3[pos + i]);

    // Frame size
    const szOff = pos + idLen;
    const frameSize = v2 ? be24(id3, szOff) : (version === 4 ? synchsafe(id3, szOff) : be32(id3, szOff));

    pos += frameHdr;
    if (frameSize <= 0 || pos + frameSize > id3.length) break;

    const dStart = pos;
    const enc = id3[dStart];

    switch (frameId) {
      case 'TIT2': case 'TT2':
        if (opts.title !== false)
          result.title = decodeText(id3, dStart + 1, frameSize - 1, enc) || null;
        break;
      case 'TPE1': case 'TP1':
        if (opts.artist !== false)
          result.artist = decodeText(id3, dStart + 1, frameSize - 1, enc) || null;
        break;
      case 'TALB': case 'TAL':
        if (opts.album !== false)
          result.album = decodeText(id3, dStart + 1, frameSize - 1, enc) || null;
        break;
      case 'TCON': case 'TCO':
        if (opts.genre !== false)
          result.genre = decodeText(id3, dStart + 1, frameSize - 1, enc) || null;
        break;
      // TYER/TYE: plain 4-digit year (v2.2/2.3). TDRC: v2.4 recording timestamp, full date.
      case 'TYER': case 'TYE': case 'TDRC':
        if (opts.year !== false) {
          const text = decodeText(id3, dStart + 1, frameSize - 1, enc);
          if (text) result.year = extractYear(text);
        }
        break;
      case 'APIC': case 'PIC':
        if (opts.picture) {
          result.picture = parseApic(id3, dStart, frameSize, v2);
          if (dbg) console.log('[id3] APIC found, parsed=', result.picture ? result.picture.slice(0, 30) : 'null');
        }
        break;
    }

    pos += frameSize;

    // Early exit once we have everything requested
    const done =
      (opts.title === false || result.title) &&
      (opts.artist === false || result.artist) &&
      (opts.album === false || result.album) &&
      (opts.genre === false || result.genre) &&
      (opts.year === false || result.year) &&
      (!opts.picture || result.picture);
    if (done) break;
  }

  return result;
}
