import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chunk, concat, fixedString, toArrayBuffer, u8, u16, u32 } from '../test-utils';
import { D3dCompression, RasterFormat, RwSection } from './constants';
import { parseTxd } from './txd';

interface NativeOptions {
  d3dFormat: number;
  flags: number;
  height: number;
  mip: Uint8Array;
  name: string;
  palette?: Uint8Array;
  rasterFormat: number;
  width: number;
}

function buildSyntheticTxd(natives: Uint8Array[]): ArrayBuffer {
  const dictStruct = chunk(RwSection.STRUCT, concat(u16(natives.length), u16(0)));

  return toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, concat(dictStruct, ...natives)));
}

function texNative(options: NativeOptions): Uint8Array {
  const header = concat(
    u32(9), // platform (D3D9)
    u32(0x1101), // filter/addressing flags
    fixedString(options.name, 32),
    fixedString('', 32), // mask name
    u32(options.rasterFormat),
    u32(options.d3dFormat),
    u16(options.width),
    u16(options.height),
    u8(8), // depth
    u8(1), // numLevels
    u8(4), // rasterType
    u8(options.flags),
  );
  const mipBlock = concat(u32(options.mip.length), options.mip);
  const struct = chunk(RwSection.STRUCT, concat(header, options.palette ?? new Uint8Array(0), mipBlock));

  return chunk(RwSection.TEXTURE_NATIVE, struct);
}

describe('parseTxd (synthetic)', () => {
  const dxt5 = texNative({
    d3dFormat: D3dCompression.DXT5,
    flags: 0x01, // hasAlpha
    height: 2,
    mip: new Uint8Array(16), // one DXT5 block
    name: 'compressed',
    rasterFormat: RasterFormat.C8888,
    width: 2,
  });

  const uncompressed = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 1,
    mip: u8(10, 20, 30, 40), // single BGRA pixel
    name: 'raw32',
    rasterFormat: RasterFormat.C8888,
    width: 1,
  });

  const palette = new Uint8Array(256 * 4);
  palette.set([1, 2, 3, 4], 0); // palette entry 0 as BGRA
  const palettized = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 1,
    mip: u8(0), // single index -> palette entry 0
    name: 'paletted',
    palette,
    rasterFormat: RasterFormat.C8888 | RasterFormat.PAL8,
    width: 1,
  });

  const unsupported = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 2,
    mip: new Uint8Array(8),
    name: 'rgb565',
    rasterFormat: RasterFormat.C565,
    width: 2,
  });

  const dict = parseTxd(buildSyntheticTxd([dxt5, uncompressed, palettized, unsupported]));

  it('skips textures with unsupported pixel formats but keeps the rest', () => {
    expect(dict.textures.map((t) => t.name)).toEqual(['compressed', 'raw32', 'paletted']);
  });

  it('classifies DXT5 and preserves raw block data', () => {
    const tex = dict.textures.find((t) => t.name === 'compressed')!;
    expect(tex.format).toBe('dxt5');
    expect(tex.hasAlpha).toBe(true);
    expect(tex.mipmaps).toHaveLength(1);
    expect(tex.mipmaps[0].data.length).toBe(16);
  });

  it('swizzles uncompressed BGRA pixels to RGBA', () => {
    const tex = dict.textures.find((t) => t.name === 'raw32')!;
    expect(tex.format).toBe('rgba8888');
    expect(Array.from(tex.mipmaps[0].data)).toEqual([30, 20, 10, 40]);
  });

  it('expands palettized indices into RGBA', () => {
    const tex = dict.textures.find((t) => t.name === 'paletted')!;
    expect(tex.format).toBe('rgba8888');
    expect(Array.from(tex.mipmaps[0].data)).toEqual([3, 2, 1, 4]);
  });

  it('rejects non-txd input', () => {
    expect(() => parseTxd(toArrayBuffer(chunk(RwSection.CLUMP, u32(0))))).toThrow(/Not a TXD/);
  });
});

const txdPath = join(process.cwd(), 'tests', 'renderware', 'testground.txd');
const txdExists = existsSync(txdPath);
// Read lazily: describe.skipIf still evaluates the suite body during collection.
const realDict = txdExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(txdPath)))) : null;

describe.skipIf(!txdExists)('parseTxd (real asset testground.txd)', () => {
  it('parses its two textures', () => {
    expect(realDict!.textures).toHaveLength(2);
  });

  it('only contains DXT-compressed formats', () => {
    const formats = new Set(realDict!.textures.map((t) => t.format));
    expect([...formats]).toEqual(['dxt1']);
  });

  it('exposes sam_camo as a 512x512 DXT1 texture', () => {
    expect(realDict!.textures.map((t) => t.name).sort()).toEqual(['bonyrd_skin2', 'sam_camo']);
    const tex = realDict!.textures.find((t) => t.name === 'sam_camo')!;
    expect([tex.width, tex.height]).toEqual([512, 512]);
    expect(tex.format).toBe('dxt1');
    expect(tex.mipmaps.length).toBeGreaterThan(0);
  });
});
