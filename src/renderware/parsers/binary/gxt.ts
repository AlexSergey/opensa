/**
 * GTA San Andreas `.gxt` text archive (e.g. `american.gxt`) → a `hash → string` map.
 *
 * SA GXT layout (8-bit build): a 4-byte version header (`04 00 08 00`), then a **TABL** block listing tables
 * (`char[8] name` + `u32 offset`, MAIN first). Each table's data is a **TKEY** block (entries of `u32
 * tdatOffset` + `u32 keyHash` — keys are **hashed**, not stored literally) followed by a **TDAT** block of
 * NUL-terminated strings. The key hash is SA's `CKeyGen::GetKey` (Jenkins one-at-a-time over the UPPERCASED
 * key); use {@link gxtKeyHash} to look a name up. Strings are kept as raw 1-byte chars (the file may be a
 * localised "fake-Latin" encoding rendered by a custom font — we extract the bytes faithfully).
 */
export function parseGxt(buffer: ArrayBuffer): Map<number, string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = new Map<number, string>();

  let cursor = fourCC(bytes, 0) === 'TABL' ? 0 : fourCC(bytes, 4) === 'TABL' ? 4 : -1;
  if (cursor < 0) {
    throw new Error('Not a GXT: no TABL block');
  }
  cursor += 4;
  const tableEnd = cursor + 4 + view.getUint32(cursor, true);
  cursor += 4;

  const tables: number[] = [];
  for (; cursor + 12 <= tableEnd; cursor += 12) {
    tables.push(view.getUint32(cursor + 8, true)); // offset; the char[8] name is unused (keys are hashed)
  }

  for (const table of tables) {
    // MAIN's data starts at TKEY directly; other tables repeat their char[8] name first.
    let at = fourCC(bytes, table) === 'TKEY' ? table : table + 8;
    if (fourCC(bytes, at) !== 'TKEY') {
      continue;
    }
    at += 4;
    const keyEnd = at + 4 + view.getUint32(at, true);
    const keyStart = at + 4;
    const dataStart = keyEnd + 8; // skip the "TDAT" + u32 size header of the string block
    if (fourCC(bytes, keyEnd) !== 'TDAT') {
      continue;
    }
    for (let entry = keyStart; entry + 8 <= keyEnd; entry += 8) {
      const stringOffset = view.getUint32(entry, true);
      const keyHash = view.getUint32(entry + 4, true);
      entries.set(keyHash, cString(bytes, dataStart + stringOffset));
    }
  }

  return entries;
}

/** CRC-32 lookup table (reflected, polynomial `0xEDB88320`). */
const CRC32_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  return table;
})();

/**
 * SA's GXT key hash: a CRC-32 (reflected, `0xEDB88320`, init `0xFFFFFFFF`) over the UPPERCASED key, **without**
 * the usual final inversion. Look up a name in {@link parseGxt}'s map via this hash.
 */
export function gxtKeyHash(key: string): number {
  const upper = key.toUpperCase();
  let crc = 0xffffffff;
  for (let i = 0; i < upper.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ upper.charCodeAt(i)) & 0xff] ^ (crc >>> 8)) >>> 0;
  }

  return crc >>> 0;
}

/** A NUL-terminated 1-byte-per-char string starting at `start`, decoded as raw Latin-1. */
function cString(bytes: Uint8Array, start: number): string {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }
  let out = '';
  for (let i = start; i < end; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }

  return out;
}

/** The 4-char ASCII tag at `offset` (e.g. "TABL"/"TKEY"/"TDAT"). */
function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}
