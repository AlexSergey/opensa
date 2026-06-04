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

  it('rejects a buffer without the WIMG magic', () => {
    expect(() => openArchive(new Uint8Array(16))).toThrow(/WIMG/);
  });
});
