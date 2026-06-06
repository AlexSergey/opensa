import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chunk, concat, f32, f32a, fixedString, i16, toArrayBuffer, u8, u16, u32 } from '../../test-utils';
import { parseColLibrary, parseDffCollision } from './col';
import { RwSection } from './constants';

interface ModelSpec {
  bounds?: { center: Vec3; max: Vec3; min: Vec3; radius: number };
  boxes?: { max: Vec3; min: Vec3; surface?: Surface }[];
  faces?: { a: number; b: number; c: number; light?: number; material?: number }[];
  fourcc: 'COL2' | 'COL3';
  modelId: number;
  name: string;
  spheres?: { center: Vec3; radius: number; surface?: Surface }[];
  vertices?: Vec3[];
}

interface Surface {
  brightness: number;
  flag: number;
  light: number;
  material: number;
}

type Vec3 = [number, number, number];

const SURFACE: Surface = { brightness: 0, flag: 0, light: 0, material: 0 };

function buildLibrary(specs: ModelSpec[]): ArrayBuffer {
  const blocks = specs.map((spec) => {
    const body = buildModelBody(spec);

    return concat(fixedString(spec.fourcc, 4), u32(body.length), body);
  });

  return toArrayBuffer(concat(...blocks));
}

/** Build a COL2/COL3 model body laid out exactly as {@link parseColLibrary} reads it. */
function buildModelBody(spec: ModelSpec): Uint8Array {
  const bounds = spec.bounds ?? { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 };
  const spheres = spec.spheres ?? [];
  const boxes = spec.boxes ?? [];
  const vertices = spec.vertices ?? [];
  const faces = spec.faces ?? [];
  const isV3 = spec.fourcc === 'COL3';

  const sphereData = concat(
    ...spheres.map((s) => concat(f32a(s.center), f32(s.radius), surfaceBytes(s.surface ?? SURFACE))),
  );
  const boxData = concat(...boxes.map((b) => concat(f32a(b.min), f32a(b.max), surfaceBytes(b.surface ?? SURFACE))));
  const vertexData = concat(
    ...vertices.map((v) =>
      concat(i16(Math.round(v[0] * 128)), i16(Math.round(v[1] * 128)), i16(Math.round(v[2] * 128))),
    ),
  );
  const faceData = concat(
    ...faces.map((fc) => concat(u16(fc.a), u16(fc.b), u16(fc.c), u8(fc.material ?? 0, fc.light ?? 0))),
  );

  // Header fields after the 40-byte bounds: 32 bytes (COL2) or 44 (COL3, +3 shadow u32);
  // data begins at body offset 64 + that. Stored section offsets are pos + 4 (the offset base).
  const dataStart = 64 + (isV3 ? 44 : 32);
  const offSpheres = dataStart;
  const offBoxes = offSpheres + sphereData.length;
  const offVertices = offBoxes + boxData.length;
  const offFaces = offVertices + vertexData.length;

  const shadow = isV3 ? [u32(0), u32(0), u32(0)] : [];

  return concat(
    fixedString(spec.name, 22),
    u16(spec.modelId),
    f32a(bounds.min),
    f32a(bounds.max),
    f32a(bounds.center),
    f32(bounds.radius),
    u16(spheres.length),
    u16(boxes.length),
    u32(faces.length),
    u32(0), // flags
    u32(offSpheres + 4),
    u32(offBoxes + 4),
    u32(0), // cones/lines offset (unused)
    u32(offVertices + 4),
    u32(offFaces + 4),
    ...shadow,
    sphereData,
    boxData,
    vertexData,
    faceData,
  );
}

function surfaceBytes(surface: Surface): Uint8Array {
  return u8(surface.material, surface.flag, surface.brightness, surface.light);
}

describe('parseColLibrary', () => {
  describe('negative cases', () => {
    it('returns no models for an empty buffer', () => {
      expect(parseColLibrary(new ArrayBuffer(0))).toEqual([]);
    });

    it('stops at a non-COL tag without throwing', () => {
      expect(parseColLibrary(toArrayBuffer(u8(1, 2, 3, 4, 5, 6, 7, 8)))).toEqual([]);
    });

    it('stops when a block size overruns the buffer', () => {
      const truncated = toArrayBuffer(concat(fixedString('COL2', 4), u32(9999), u8(0, 0, 0, 0)));
      expect(parseColLibrary(truncated)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses a single COL2 model header and bounds', () => {
      const buffer = buildLibrary([
        {
          bounds: { center: [1, 2, 3], max: [4, 5, 6], min: [-4, -5, -6], radius: 7 },
          fourcc: 'COL2',
          modelId: 966,
          name: 'gate01',
        },
      ]);

      const [model] = parseColLibrary(buffer);
      expect(model.name).toBe('gate01');
      expect(model.modelId).toBe(966);
      expect(model.version).toBe(2);
      expect(model.bounds).toEqual({ center: [1, 2, 3], max: [4, 5, 6], min: [-4, -5, -6], radius: 7 });
      expect(model.faces).toEqual([]);
      expect(model.vertices).toHaveLength(0);
    });

    it('reads spheres and boxes with their surface', () => {
      const buffer = buildLibrary([
        {
          boxes: [
            { max: [1, 1, 1], min: [-1, -1, -1], surface: { brightness: 187, flag: 0, light: 56, material: 10 } },
          ],
          fourcc: 'COL2',
          modelId: 1,
          name: 'box01',
          spheres: [
            { center: [4.5, 0, -1], radius: 0.5, surface: { brightness: 187, flag: 0, light: 77, material: 55 } },
          ],
        },
      ]);

      const [model] = parseColLibrary(buffer);
      expect(model.spheres).toEqual([
        { center: [4.5, 0, -1], radius: 0.5, surface: { brightness: 187, flag: 0, light: 77, material: 55 } },
      ]);
      expect(model.boxes).toEqual([
        { max: [1, 1, 1], min: [-1, -1, -1], surface: { brightness: 187, flag: 0, light: 56, material: 10 } },
      ]);
    });

    it('decompresses vertices and reads the triangle mesh (COL3)', () => {
      const buffer = buildLibrary([
        {
          faces: [{ a: 0, b: 1, c: 2, light: 47, material: 37 }],
          fourcc: 'COL3',
          modelId: 11782,
          name: 'mesh01',
          // values are exact multiples of 1/128 so int16/128 round-trips exactly
          vertices: [
            [1.5, -2.25, 0.5],
            [0.0078125, 2, -1],
            [-3, 0, 1.25],
          ],
        },
      ]);

      const [model] = parseColLibrary(buffer);
      expect(model.version).toBe(3);
      expect(Array.from(model.vertices)).toEqual([1.5, -2.25, 0.5, 0.0078125, 2, -1, -3, 0, 1.25]);
      expect(model.faces).toEqual([{ a: 0, b: 1, c: 2, light: 47, material: 37 }]);
    });

    it('derives the vertex count from the highest face index', () => {
      const buffer = buildLibrary([
        {
          faces: [{ a: 2, b: 0, c: 1 }],
          fourcc: 'COL3',
          modelId: 1,
          name: 'tri',
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
        },
      ]);

      const [model] = parseColLibrary(buffer);
      expect(model.vertices).toHaveLength(9); // 3 vertices * 3 components
    });

    it('parses multiple models in one library', () => {
      const buffer = buildLibrary([
        { fourcc: 'COL2', modelId: 1, name: 'a' },
        { faces: [{ a: 0, b: 0, c: 0 }], fourcc: 'COL3', modelId: 2, name: 'b', vertices: [[0, 0, 0]] },
      ]);

      const models = parseColLibrary(buffer);
      expect(models.map((m) => m.name)).toEqual(['a', 'b']);
      expect(models.map((m) => m.version)).toEqual([2, 3]);
    });
  });
});

/** Wrap a COL library inside a DFF Clump's Extension as the Collision (0x253f2fa) plugin. */
function dffWithCollision(col: ArrayBuffer): ArrayBuffer {
  const collision = chunk(RwSection.COLLISION, new Uint8Array(col));

  return toArrayBuffer(chunk(RwSection.CLUMP, chunk(RwSection.EXTENSION, collision)));
}

describe('parseDffCollision', () => {
  describe('negative cases', () => {
    it('returns null when the clump has no collision extension', () => {
      const dff = toArrayBuffer(chunk(RwSection.CLUMP, chunk(RwSection.STRUCT, u32(0))));
      expect(parseDffCollision(dff)).toBeNull();
    });

    it('returns null for non-clump input', () => {
      expect(parseDffCollision(toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, u32(0))))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('extracts the COL model embedded in the DFF', () => {
      const col = buildLibrary([
        {
          faces: [{ a: 0, b: 1, c: 2 }],
          fourcc: 'COL3',
          modelId: 7,
          name: 'car_col',
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
        },
      ]);
      const model = parseDffCollision(dffWithCollision(col));
      expect(model?.name).toBe('car_col');
      expect(model?.faces).toHaveLength(1);
      expect(model?.version).toBe(3);
    });
  });
});

const archivePath = join(process.cwd(), 'static', 'models', 'gta3.img');
const archiveExists = existsSync(archivePath);

/** Read a single entry out of the WIMG archive without loading the whole 758 MB file. */
function readArchiveEntry(name: string): ArrayBuffer | null {
  const fd = openSync(archivePath, 'r');
  try {
    const header = Buffer.alloc(12);
    readSync(fd, header, 0, 12, 0);
    const directoryLength = header.readUInt32LE(8);
    const directory = Buffer.alloc(directoryLength);
    readSync(fd, directory, 0, directoryLength, 12);
    const files = (JSON.parse(directory.toString('utf8')) as { files: Record<string, [number, number]> }).files;
    const entry = files[name.toLowerCase()];
    if (!entry) {
      return null;
    }
    const [offset, size] = entry;
    const out = Buffer.alloc(size);
    readSync(fd, out, 0, size, 12 + directoryLength + offset);

    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } finally {
    closeSync(fd);
  }
}

describe.skipIf(!archiveExists)('parseColLibrary (real archive .col)', () => {
  it('parses the COL2 library barriers.col and binds box/mesh models', () => {
    const models = parseColLibrary(readArchiveEntry('barriers.col')!);
    expect(models.length).toBeGreaterThan(0);

    const gate = models.find((m) => m.name === 'bar_gatebar01');
    expect(gate?.version).toBe(2);
    expect(gate?.boxes.length).toBeGreaterThan(0);

    const meshModel = models.find((m) => m.faces.length > 0);
    expect(meshModel).toBeDefined();
    expect(meshModel!.vertices.length).toBe((Math.max(...meshModel!.faces.flatMap((f) => [f.a, f.b, f.c])) + 1) * 3);
  });

  it('parses a COL3 library with a decompressed mesh inside its bounds', () => {
    const model = parseColLibrary(readArchiveEntry('countn2_1.col')!).find((m) => m.name === 'cen_bit_18');
    expect(model?.version).toBe(3);
    expect(model?.faces).toHaveLength(118);

    const { bounds, vertices } = model!;
    for (let i = 0; i < vertices.length; i += 3) {
      expect(vertices[i]).toBeGreaterThanOrEqual(bounds.min[0] - 0.5);
      expect(vertices[i]).toBeLessThanOrEqual(bounds.max[0] + 0.5);
      expect(vertices[i + 1]).toBeGreaterThanOrEqual(bounds.min[1] - 0.5);
      expect(vertices[i + 1]).toBeLessThanOrEqual(bounds.max[1] + 0.5);
      expect(vertices[i + 2]).toBeGreaterThanOrEqual(bounds.min[2] - 0.5);
      expect(vertices[i + 2]).toBeLessThanOrEqual(bounds.max[2] + 0.5);
    }
  });
});
