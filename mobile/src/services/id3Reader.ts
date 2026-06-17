import * as LegacyFS from 'expo-file-system/legacy';

const CHUNK_SIZE = 256 * 1024; // 256 KB per read

export interface Id3Tags {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  /** Base64 data URL: "data:<mime>;base64,<data>" */
  picture: string | null;
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

let _dbgCount = 0;

export async function readId3Tags(
  uri: string,
  opts: { title?: boolean; artist?: boolean; album?: boolean; genre?: boolean; picture?: boolean } = {},
): Promise<Id3Tags> {
  const dbg = _dbgCount++ < 3;
  const result: Id3Tags = { title: null, artist: null, album: null, genre: null, picture: null };

  // Read first chunk — always contains the ID3 header if one exists
  const first = await readBytes(uri, 0, CHUNK_SIZE);
  if (dbg) console.log('[id3] readBytes result:', first ? `${first.length} bytes, first3=${first[0]},${first[1]},${first[2]}` : 'null', 'uri=', uri.slice(-30));
  if (!first || first.length < 10) return result;

  // ID3v2 magic
  if (first[0] !== 0x49 || first[1] !== 0x44 || first[2] !== 0x33) {
    if (dbg) console.log('[id3] no ID3 magic');
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
      (!opts.picture || result.picture);
    if (done) break;
  }

  return result;
}
