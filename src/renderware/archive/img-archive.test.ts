import { describe, expect, it } from 'vitest';

import { buildArchiveBuffer, openArchive } from './img-archive';

describe('img-archive', () => {
  it('round-trips files looked up by lowercased name', () => {
    const dff = new Uint8Array([1, 2, 3, 4, 5]);
    const txd = new Uint8Array([9, 8, 7]);
    const archive = openArchive(
      buildArchiveBuffer([
        { data: dff, name: 'Veg_Palm04.dff' },
        { data: txd, name: 'foo.TXD' },
      ]),
    );

    expect(new Uint8Array(archive.get('veg_palm04.dff')!)).toEqual(dff);
    expect(new Uint8Array(archive.get('FOO.txd')!)).toEqual(txd);
    expect(archive.get('missing.dff')).toBeNull();
    expect(archive.names.sort()).toEqual(['foo.txd', 'veg_palm04.dff']);
  });

  it('reads a file from a non-zero byteOffset backing buffer', () => {
    const packed = buildArchiveBuffer([{ data: new Uint8Array([42, 43]), name: 'a.dff' }]);
    const padded = new Uint8Array(packed.length + 7);
    padded.set(packed, 7);
    const archive = openArchive(padded.subarray(7));
    expect(new Uint8Array(archive.get('a.dff')!)).toEqual(new Uint8Array([42, 43]));
  });

  it('rejects a buffer without a known magic', () => {
    expect(() => openArchive(new Uint8Array(16))).toThrow(/WIMG/);
  });

  it('reads a stock GTA VER2 archive (sector offsets, lowercased lookup)', () => {
    const dff = new Uint8Array([1, 2, 3, 4, 5]);
    const txd = new Uint8Array([9, 8, 7]);
    const archive = openArchive(
      buildVer2([
        { data: dff, name: 'Lamp.dff' },
        { data: txd, name: 'FOO.txd' },
      ]),
    );

    // VER2 sizes are padded to whole sectors; the file's real bytes are the slice's prefix.
    expect(new Uint8Array(archive.get('lamp.dff')!).subarray(0, dff.length)).toEqual(dff);
    expect(new Uint8Array(archive.get('foo.TXD')!).subarray(0, txd.length)).toEqual(txd);
    expect(archive.get('missing.dff')).toBeNull();
    expect(archive.names.sort()).toEqual(['foo.txd', 'lamp.dff']);
  });
});

/** Build a minimal stock GTA San Andreas VER2 `.img` (inline directory, 2048-byte sectors) for the tests. */
function buildVer2(entries: { data: Uint8Array; name: string }[]): Uint8Array {
  const SECTOR = 2048;
  const dirSectors = Math.ceil((8 + entries.length * 32) / SECTOR);
  let cursor = dirSectors;
  const placed = entries.map((entry) => {
    const sectors = Math.max(1, Math.ceil(entry.data.length / SECTOR));
    const at = cursor;
    cursor += sectors;

    return { ...entry, offset: at, sectors };
  });
  const out = new Uint8Array(cursor * SECTOR);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('VER2'), 0);
  view.setUint32(4, entries.length, true);
  placed.forEach((entry, i) => {
    const base = 8 + i * 32;
    view.setUint32(base, entry.offset, true);
    view.setUint16(base + 4, entry.sectors, true);
    out.set(new TextEncoder().encode(entry.name), base + 8);
    out.set(entry.data, entry.offset * SECTOR);
  });

  return out;
}
