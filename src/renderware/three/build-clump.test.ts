import type { MeshStandardMaterial } from 'three';

import { existsSync, readFileSync } from 'node:fs';
import { DoubleSide, FrontSide, Mesh, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildClump, buildClumpParts, buildMaterial } from './build-clump';

function alphaTextureMap(): Map<string, Texture> {
  const tex = new Texture();
  tex.name = 'tree_branches44';
  tex.userData.hasAlpha = true;

  return new Map([['tree_branches44', tex]]);
}

function clumpWith(geo: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'Mesh', parentIndex: -1, position: [1, 2, 3], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geo],
  };
}

/** Recursively: does any value in `obj` hold a live three Texture? (userData must stay JSON-serializable.) */
function containsTexture(value: unknown): boolean {
  if (value instanceof Texture) {
    return true;
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsTexture);
  }

  return false;
}

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    lights: [],
    materials: [
      material({ texture: { maskName: '', name: 'tree_branches44' }, textured: true }),
      material({ color: [200, 100, 50, 255] }),
    ],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    prelitColors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
    triangles: [
      { a: 0, b: 1, c: 2, materialIndex: 0 },
      { a: 0, b: 2, c: 3, materialIndex: 0 },
      { a: 1, b: 2, c: 3, materialIndex: 1 },
    ],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

describe('buildClump', () => {
  it('creates one mesh per atomic, named after its frame', () => {
    const group = buildClump(clumpWith(geometry()));
    expect(group.children).toHaveLength(1);
    expect(group.children[0]).toBeInstanceOf(Mesh);
    expect(group.children[0].name).toBe('Mesh');
  });

  it('rotates the root from RenderWare Z-up to three.js Y-up', () => {
    const group = buildClump(clumpWith(geometry()));
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('applies the frame transform to the mesh', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0];
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
  });

  it('builds position, uv and color attributes', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    const attrs = mesh.geometry.attributes;
    expect(attrs.position.count).toBe(4);
    expect(attrs.uv.count).toBe(4);
    expect(attrs.color.count).toBe(4);
    // prelit byte 255 -> normalized 1
    expect(attrs.color.getX(0)).toBeCloseTo(1, 5);
  });

  it('computes vertex normals when the geometry stores none', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    expect(mesh.geometry.attributes.normal).toBeDefined();
    expect(mesh.geometry.attributes.normal.count).toBe(4);
  });

  it('groups the index buffer by material', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    expect(mesh.geometry.index?.count).toBe(9); // 3 triangles
    expect(mesh.geometry.groups).toEqual([
      { count: 6, materialIndex: 0, start: 0 },
      { count: 3, materialIndex: 1, start: 6 },
    ]);
  });

  it('assigns the resolved texture and alpha settings to the material', () => {
    const mesh = buildClump(clumpWith(geometry()), alphaTextureMap()).children[0] as Mesh;
    const materials = mesh.material as MeshStandardMaterial[];
    expect(materials[0].map?.name).toBe('tree_branches44');
    expect(materials[0].transparent).toBe(true);
    expect(materials[0].alphaTest).toBe(0.5);
    expect(materials[0].side).toBe(DoubleSide);
    expect(materials[0].vertexColors).toBe(true);
  });

  it('uses the material colour and front-side rendering when untextured', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    const materials = mesh.material as MeshStandardMaterial[];
    expect(materials[1].side).toBe(FrontSide);
    expect(materials[1].transparent).toBe(false);
    expect(materials[1].color.getHex()).toBe((200 << 16) | (100 << 8) | 50);
  });

  it('preserves stored normals when present', () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const mesh = buildClump(clumpWith(geometry({ normals }))).children[0] as Mesh;
    expect(Array.from(mesh.geometry.attributes.normal.array.slice(0, 3))).toEqual([0, 0, 1]);
  });
});

// Real regression case (plan 037): the gta3-pf.img re-export of the Casino Royale building stores
// a normals block that is ~81% exact zeros (SA's prelit-only map pipeline never reads normals, so
// the mod shipped garbage) — zero normals rendered the building black under our dynamic sun.
const CASROYALE_DFF = 'tests/dff/casroyale-zero-normals/casroyale02_lvs.dff';

/** Count of zero-length (or non-finite) normals in a packed xyz array. */
function degenerateCount(normals: Float32Array): number {
  let count = 0;
  for (let v = 0; v < normals.length / 3; v += 1) {
    const lengthSq = normals[v * 3] ** 2 + normals[v * 3 + 1] ** 2 + normals[v * 3 + 2] ** 2;
    if (!Number.isFinite(lengthSq) || lengthSq < 1e-8) {
      count += 1;
    }
  }

  return count;
}

function parseCasroyale(): RWClump {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(CASROYALE_DFF))));
}

describe('stored-normal sanitization (casroyale zero-normals case)', () => {
  describe('negative cases', () => {
    it('the fixture ships zero-length stored normals (the broken input)', () => {
      const clump = parseCasroyale();
      const stored = clump.geometries[0].normals;
      expect(stored).not.toBeNull();
      expect(degenerateCount(stored as Float32Array)).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('builds the real model with no zero/non-finite normals left', () => {
      const group = buildClump(parseCasroyale());
      const meshes = group.children.filter((child): child is Mesh => (child as Mesh).isMesh);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        expect(degenerateCount(mesh.geometry.attributes.normal.array as Float32Array)).toBe(0);
      }
    });

    it('repairs synthetic NaN stored normals (finiteness guard)', () => {
      const normals = new Float32Array([NaN, NaN, NaN, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
      const mesh = buildClump(clumpWith(geometry({ normals }))).children[0] as Mesh;
      expect(degenerateCount(mesh.geometry.attributes.normal.array as Float32Array)).toBe(0);
    });
  });
});

// Real prelit map model that ships BOTH day prelit and SA night (extra) vertex colours (plan 038).
const WASHER_DFF = 'tests/dff/building/washer.dff';

describe.skipIf(!existsSync(WASHER_DFF))('day/night vertex colours (real washer.dff)', () => {
  const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(WASHER_DFF))));

  describe('positive cases', () => {
    it('the fixture ships both prelit and night vertex colours (the input)', () => {
      expect(clump.geometries[0].prelitColors).not.toBeNull();
      expect(clump.geometries[0].nightColors).not.toBeNull();
    });

    it('builds a nightColor attribute (the dnBalance day↔night blend set) alongside the day color', () => {
      // The map pipeline (buildClumpParts) carries the night set the unlit world material's dnBalance mix consumes.
      const [part] = buildClumpParts(clump);
      const day = part.geometry.getAttribute('color');
      const night = part.geometry.getAttribute('nightColor');
      expect(day).toBeDefined();
      expect(night).toBeDefined();
      expect(night.itemSize).toBe(3);
      expect(night.count).toBe(part.geometry.getAttribute('position').count);
      for (const value of night.array as Float32Array) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1); // bytes normalised to 0..1
      }
    });
  });
});

/** Minimal stand-in for the parameters object three passes to `onBeforeCompile`. */
interface ShaderStub {
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

describe('buildMaterial — SA env-map reflection (userData stays serializable)', () => {
  const ENV = 'generic_envmap9';
  // Translucent → also a glass material, so the vehicle glass-pass clones it (where the bug surfaced).
  const reflectiveMat = (): RWMaterial =>
    material({
      color: [255, 255, 255, 128],
      effects: { envMap: { coefficient: 0.5, texture: ENV, useFrameBufferAlpha: false } },
    });
  const envTextures = (): Map<string, Texture> => {
    const env = new Texture();
    env.name = ENV;

    return new Map([[ENV, env]]);
  };
  const runOnBeforeCompile = (mat: MeshStandardMaterial): ShaderStub => {
    const shader: ShaderStub = { fragmentShader: '#include <emissivemap_fragment>', uniforms: {}, vertexShader: '' };
    (mat.onBeforeCompile as unknown as (s: ShaderStub) => void)(shader);

    return shader;
  };

  describe('negative cases', () => {
    it('non-reflective materials get no SA-reflect holder and no texture in userData', () => {
      const mat = buildMaterial(material(), geometry(), new Map());
      expect(mat.userData.saReflect).toBeUndefined();
      expect(containsTexture(mat.userData)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('keeps the env Texture off userData (only the JSON-safe strength holder remains)', () => {
      const mat = buildMaterial(reflectiveMat(), geometry(), envTextures());
      const sa = mat.userData.saReflect as { saStrength: { value: number } };
      expect(sa.saStrength).toEqual({ value: 0 }); // plugin-driven, serializable
      expect(containsTexture(mat.userData)).toBe(false); // the Texture is NOT on userData (the bug)
    });

    it('still wires the env Texture into the shader uniform (reflection preserved)', () => {
      const textures = envTextures();
      const mat = buildMaterial(reflectiveMat(), geometry(), textures);
      const shader = runOnBeforeCompile(mat);
      const sa = mat.userData.saReflect as { saStrength: unknown };
      expect(shader.uniforms.saEnvMap.value).toBe(textures.get(ENV)); // texture flows via the closure
      expect(shader.uniforms.saStrength).toBe(sa.saStrength); // same holder the plugin drives
    });

    it('cloning a reflective material leaves no Texture in the clone userData (glass-pass safe)', () => {
      const mat = buildMaterial(reflectiveMat(), geometry(), envTextures());
      expect(containsTexture(mat.clone().userData)).toBe(false);
    });
  });
});
