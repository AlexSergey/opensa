/**
 * Stock→custom prelight transfer for the LOD tools (`--prelight`). Custom HD models often ship with badly-set
 * prelit (black / washed-out) versus the stock model SA lit for that spot, and SA draws `prelit × material`, so the
 * surface looks wrong in-world. We take one representative ambient colour from the **stock** model's prelit and
 * write it onto the **trunk** (opaque surfaces) of the swapped HD DFF and its LOD; **foliage** (alpha-cutout)
 * keeps its own prelit so leaves stay natural. Shared by `lod-trees-generator` (HD swap + atlas bake) and
 * `lod-procobj-generator` (HD swap + decimated LOD mesh).
 */
import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { MergedMesh } from './mesh';

const RW_STRUCT = 0x01;
const PRELIT_FLAG = 0x0008; // rpGEOMETRYPRELIT — geometry Struct carries one RGBA per vertex
const WHITE: Rgba = [255, 255, 255, 255];

/** Classifies a (lowercased) texture name as foliage — alpha-cutout leaves — vs an opaque trunk/bark surface. */
export type FoliagePredicate = (textureName: string) => boolean;

/**
 * Optional per-model overrides for `--prelight`, loaded from a JSON file passed as `--prelight <info.json>`:
 *
 * ```json
 * { "tree_hipoly09b": { "skip": true }, "vbg_fir_copse": { "skip": true } }
 * ```
 *
 * Without the file, `--prelight` applies to every model (the default). The shape is per-model objects so more
 * knobs can be added later; only `skip` (opt a model out of the prelight transfer) is honoured today.
 */
export interface PrelightInfo {
  /** Lowercased model names to **not** apply prelight to (HD swap + LOD both skipped). */
  skip: ReadonlySet<string>;
}

interface PrelightOverride {
  skip?: boolean;
}

type Rgba = readonly [number, number, number, number];

/**
 * Recolour a decimated LOD {@link MergedMesh}'s **trunk** vertices to the stock ambient `trunk` colour so the LOD
 * matches a `--prelight`-corrected HD; foliage vertices (touched by an alpha-textured group) keep their colour.
 * Mutates `mesh.colors` in place.
 */
export function applyMeshTrunkPrelight(mesh: MergedMesh, trunk: Rgba, isFoliage: FoliagePredicate): void {
  const foliage = new Set<number>();
  for (const group of mesh.groups) {
    if (group.texture !== '' && isFoliage(group.texture)) {
      for (const index of group.indices) {
        foliage.add(index);
      }
    }
  }
  const count = mesh.colors.length / 4;
  for (let v = 0; v < count; v += 1) {
    if (!foliage.has(v)) {
      mesh.colors.set(trunk, v * 4);
    }
  }
}

/**
 * Transfer the **stock** model's prelight onto a **custom** swapped HD DFF, but **only on the trunk** (opaque
 * surfaces) — foliage (alpha-cutout) keeps its own prelit so the leaves stay natural.
 *
 * Topology differs between stock and custom, so we take one representative colour from the stock prelit and fill
 * the custom's **trunk** vertices with it (setting the PRELIT flag + allocating the array if absent). Foliage
 * vertices keep the custom's existing prelit (or white when it had none). No-ops when the stock carries no prelit.
 */
export function applyStockPrelight(
  customDff: Uint8Array,
  stockDff: Uint8Array,
  isFoliage: FoliagePredicate,
): Uint8Array {
  const average = stockPrelightColor(stockDff);
  if (!average) {
    return customDff; // nothing to transfer — leave the custom untouched
  }
  const masks = foliageVertexMasks(customDff, isFoliage);

  const file = readRw(customDff);
  collectGeometries(file.chunks).forEach((geometry, i) => {
    const child = geometry.children?.find((c) => c.type === RW_STRUCT);
    if (!child?.data) {
      return;
    }
    const struct = decodeGeometryStruct(child.data);
    if (struct.native !== 0) {
      return; // native (pre-instanced) geometry — the non-native Struct codec can't express it; leave as-is
    }
    struct.prelit = trunkOnlyPrelit(struct.numVertices, struct.prelit, average, masks[i] ?? []);
    struct.flags |= PRELIT_FLAG;
    child.data = encodeGeometryStruct(struct);
  });

  return writeRw(file);
}

/** Parse a `--prelight` info JSON (`{ "<model>": { "skip": true }, … }`) into a {@link PrelightInfo}. */
export function parsePrelightInfo(text: string): PrelightInfo {
  const data = JSON.parse(text) as Record<string, PrelightOverride | undefined>;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('prelight info must be a JSON object of `{ "<model>": { "skip": true } }`');
  }
  const skip = new Set<string>();
  for (const [model, override] of Object.entries(data)) {
    if (override?.skip) {
      skip.add(model.toLowerCase());
    }
  }

  return { skip };
}

/** The stock model's representative prelit colour (mean RGBA over its prelit vertices), or `null` if it has none. */
export function stockPrelightColor(stockDff: Uint8Array): null | Rgba {
  const withPrelit = geometryStructs(stockDff).filter(hasPrelit);

  return withPrelit.length === 0 ? null : averageColour(withPrelit);
}

/** A prelit array where trunk vertices take the stock `average` and foliage vertices keep `existing` (or white). */
export function trunkOnlyPrelit(
  numVertices: number,
  existing: null | Uint8Array,
  average: Rgba,
  foliageMask: readonly boolean[],
): Uint8Array {
  const out = new Uint8Array(numVertices * 4);
  for (let v = 0; v < numVertices; v += 1) {
    if (foliageMask[v]) {
      out.set(existing ? existing.subarray(v * 4, v * 4 + 4) : WHITE, v * 4); // foliage — keep custom / white
    } else {
      out.set(average, v * 4); // trunk — stock ambient
    }
  }

  return out;
}

/** Mean RGBA across every prelit vertex of the given (prelit-bearing) geometries. */
function averageColour(structs: readonly GeometryStruct[]): Rgba {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (const struct of structs) {
    const prelit = struct.prelit!;
    for (let i = 0; i < prelit.length; i += 4) {
      r += prelit[i];
      g += prelit[i + 1];
      b += prelit[i + 2];
      a += prelit[i + 3];
      n += 1;
    }
  }

  return n === 0 ? [255, 255, 255, 255] : [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

/**
 * Per geometry, a per-vertex mask: `true` where the vertex is touched by a foliage (alpha-textured) triangle.
 * Falls back to all-trunk (`[]`) if the DFF can't be parsed for materials — prelight then applies everywhere.
 */
function foliageVertexMasks(customDff: Uint8Array, isFoliage: FoliagePredicate): boolean[][] {
  try {
    return parseDff(toArrayBuffer(customDff)).geometries.map((geo) => {
      const mask = new Array<boolean>(geo.positions.length / 3).fill(false);
      for (const tri of geo.triangles) {
        const name = geo.materials[tri.materialIndex]?.texture?.name?.toLowerCase();
        if (name && isFoliage(name)) {
          mask[tri.a] = true;
          mask[tri.b] = true;
          mask[tri.c] = true;
        }
      }

      return mask;
    });
  } catch {
    return [];
  }
}

/** Decode each geometry's Struct (in geometry order; `null` for a geometry without one). */
function geometryStructs(dff: Uint8Array): (GeometryStruct | null)[] {
  return collectGeometries(readRw(dff).chunks).map((geometry) => {
    const data = geometry.children?.find((c) => c.type === RW_STRUCT)?.data;

    return data ? decodeGeometryStruct(data) : null;
  });
}

function hasPrelit(struct: GeometryStruct | null): struct is GeometryStruct {
  return struct !== null && struct.native === 0 && (struct.flags & PRELIT_FLAG) !== 0 && struct.prelit !== null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}
