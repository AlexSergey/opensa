import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chunk, concat, fixedString, toArrayBuffer, u8, u16, u32 } from '../../test-utils';
import { D3dCompression, RasterFormat, RwSection } from './constants';
import { parseTxd } from './txd';

interface NativeOptions {
  d3dFormat: number;
  depth?: number;
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
    u8(options.depth ?? 8), // depth
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

  // X8R8G8B8 / rasterFormat C888 (0x600) — 32-bit; was previously dropped.
  const x8r8g8b8 = texNative({
    d3dFormat: 0x16,
    flags: 0x00,
    height: 1,
    mip: u8(11, 22, 33, 0),
    name: 'raw32x',
    rasterFormat: RasterFormat.C888,
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

  // 16-bit rasters (plan 043): R5G6B5 pure red, A1R5G5B5 opaque green, A4R4G4B4 half-alpha blue.
  const rgb565 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x00,
    height: 1,
    mip: u8(0x00, 0xf8), // 0xF800 = R=31 G=0 B=0
    name: 'rgb565',
    rasterFormat: RasterFormat.C565,
    width: 1,
  });

  const argb1555 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x01,
    height: 1,
    mip: u8(0xe0, 0x83), // 0x83E0 = A=1 R=0 G=31 B=0
    name: 'argb1555',
    rasterFormat: RasterFormat.C1555,
    width: 1,
  });

  const argb4444 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x01,
    height: 1,
    mip: u8(0x0f, 0x80), // 0x800F = A=8 R=0 G=0 B=15
    name: 'argb4444',
    rasterFormat: RasterFormat.C4444,
    width: 1,
  });

  const unsupported = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 2,
    mip: new Uint8Array(4),
    name: 'lum8',
    rasterFormat: RasterFormat.LUM8,
    width: 2,
  });

  const dict = parseTxd(
    buildSyntheticTxd([dxt5, uncompressed, x8r8g8b8, palettized, rgb565, argb1555, argb4444, unsupported]),
  );

  it('skips textures with unsupported pixel formats but keeps the rest', () => {
    expect(dict.textures.map((t) => t.name)).toEqual([
      'compressed',
      'raw32',
      'raw32x',
      'paletted',
      'rgb565',
      'argb1555',
      'argb4444',
    ]);
  });

  it('expands 16-bit rasters to RGBA8888 (plan 043: previously dropped)', () => {
    const red = dict.textures.find((t) => t.name === 'rgb565')!;
    expect(red.format).toBe('rgba8888');
    expect(Array.from(red.mipmaps[0].data)).toEqual([255, 0, 0, 255]);

    const green = dict.textures.find((t) => t.name === 'argb1555')!;
    expect(Array.from(green.mipmaps[0].data)).toEqual([0, 255, 0, 255]);

    const blue = dict.textures.find((t) => t.name === 'argb4444')!;
    expect(Array.from(blue.mipmaps[0].data)).toEqual([0, 0, 255, 8 * 17]);
  });

  it('keeps 32-bit X8R8G8B8 / C888 textures (regression: palm trunks went white)', () => {
    const tex = dict.textures.find((t) => t.name === 'raw32x')!;
    expect(tex.format).toBe('rgba8888');
    expect(Array.from(tex.mipmaps[0].data)).toEqual([33, 22, 11, 0]); // BGRX -> RGBA
  });

  it('classifies DXT5 and preserves raw block data', () => {
    const tex = dict.textures.find((t) => t.name === 'compressed')!;
    expect(tex.format).toBe('dxt5');
    expect(tex.hasAlpha).toBe(true);
    expect(tex.mipmaps).toHaveLength(1);
    expect(tex.mipmaps[0].data.length).toBe(16);
  });

  it('skips trailing zero-size mip levels (WebGL rejects empty compressed data)', () => {
    const header = concat(
      u32(9),
      u32(0x1101),
      fixedString('mips', 32),
      fixedString('', 32),
      u32(RasterFormat.C8888),
      u32(D3dCompression.DXT1),
      u16(4),
      u16(4),
      u8(8),
      u8(2), // numLevels = 2, but the second is empty
      u8(4),
      u8(0x00),
    );
    const level0 = concat(u32(8), new Uint8Array(8)); // one 4x4 DXT1 block
    const level1 = u32(0); // declared mip with zero bytes
    const native = chunk(RwSection.TEXTURE_NATIVE, chunk(RwSection.STRUCT, concat(header, level0, level1)));
    const tex = parseTxd(buildSyntheticTxd([native])).textures.find((t) => t.name === 'mips')!;
    expect(tex.mipmaps).toHaveLength(1);
    expect(tex.mipmaps[0].data.length).toBe(8);
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

  it('skips a leading non-dictionary chunk before the TexDictionary (RwStreamFindChunk behaviour)', () => {
    // Some mod/exporter TXDs prepend an empty type-0 chunk before the dictionary.
    const dict = chunk(
      RwSection.TEXTURE_DICTIONARY,
      concat(chunk(RwSection.STRUCT, concat(u16(1), u16(0))), uncompressed),
    );
    const withPrefix = toArrayBuffer(concat(chunk(0, new Uint8Array(0)), dict));
    expect(parseTxd(withPrefix).textures.map((t) => t.name)).toEqual(['raw32']);
  });

  it('rejects non-txd input', () => {
    expect(() => parseTxd(toArrayBuffer(chunk(RwSection.CLUMP, u32(0))))).toThrow(/Not a TXD/);
  });
});

const txdPath = join(process.cwd(), 'tests', 'original', 'txd', 'junk.txd');
const txdExists = existsSync(txdPath);
// Read lazily: describe.skipIf still evaluates the suite body during collection.
const realDict = txdExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(txdPath)))) : null;

describe.skipIf(!txdExists)('parseTxd (real asset junk.txd)', () => {
  it('parses its two textures', () => {
    expect(realDict!.textures).toHaveLength(2);
  });

  it('only contains DXT1-compressed formats', () => {
    const formats = new Set(realDict!.textures.map((t) => t.format));
    expect([...formats]).toEqual(['dxt1']);
  });

  it('exposes junk_tyre as a 64x64 opaque DXT1 texture', () => {
    expect(realDict!.textures.map((t) => t.name).sort()).toEqual(['junk_tyre', 'tyretread_64H']);
    const tex = realDict!.textures.find((t) => t.name === 'junk_tyre')!;
    expect([tex.width, tex.height]).toEqual([64, 64]);
    expect(tex.format).toBe('dxt1');
    expect(tex.hasAlpha).toBe(false);
    expect(tex.mipmaps.length).toBeGreaterThan(0);
  });
});

// A real mod TXD (yosemite / Ford F350) with two anti-rip quirks: a leading empty type-0 chunk before the
// dictionary (broke `readDictHeader`), AND inflated TEXTURE_NATIVE sizes that swallow following textures
// (declares 20, a boundary walk finds 10) — the count-based recovery restores all 20, incl. the F350_mix body.
const yosemitePath = join(process.cwd(), 'tests', 'custom', 'txd', 'yosemite.txd');
const yosemiteExists = existsSync(yosemitePath);
const yosemiteDict = yosemiteExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(yosemitePath)))) : null;

describe.skipIf(!yosemiteExists)('parseTxd (real asset yosemite.txd — leading chunk + inflated sizes)', () => {
  it('recovers all 20 textures the inflated sizes hid (past the leading empty chunk)', () => {
    expect(yosemiteDict!.textures).toHaveLength(20);
    const names = yosemiteDict!.textures.map((t) => t.name);
    expect(names).toContain('F350_interior');
    expect(names).toContain('F350_mix'); // the body texture a boundary walk misses
  });
});
