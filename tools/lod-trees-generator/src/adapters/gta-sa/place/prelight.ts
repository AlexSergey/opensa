import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { readRw, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

const RW_STRUCT = 0x01;
const PRELIT_FLAG = 0x0008; // rpGEOMETRYPRELIT — geometry Struct carries one RGBA per vertex

type Rgba = readonly [number, number, number, number];

/**
 * Transfer the **stock** model's prelight (day vertex colours) onto a **custom** swapped HD DFF. Custom trees
 * often ship with badly-set prelit (black / washed-out) versus the stock model SA lit for that spot, and SA draws
 * foliage as `prelit × material`, so the custom looks wrong in-world.
 *
 * Topology differs between stock and custom, so a per-vertex copy isn't generally possible — SA tree prelit is a
 * near-uniform ambient tint anyway. So we take a representative colour from the stock prelit and **fill the custom
 * uniformly** (setting the PRELIT flag + allocating the array if absent). A same-`numVertices` geometry keeps full
 * fidelity via a verbatim copy (the custom is a stock re-export). No-ops when the stock carries no prelit.
 */
export function applyStockPrelight(customDff: Uint8Array, stockDff: Uint8Array): Uint8Array {
  const stockStructs = geometryStructs(stockDff);
  const withPrelit = stockStructs.filter((s) => hasPrelit(s));
  if (withPrelit.length === 0) {
    return customDff; // nothing to transfer — leave the custom untouched
  }
  const average = averageColour(withPrelit);

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
    const stock = stockStructs[i];
    struct.prelit =
      stock && hasPrelit(stock) && stock.numVertices === struct.numVertices
        ? stock.prelit!.slice()
        : fill(struct.numVertices, average);
    struct.flags |= PRELIT_FLAG;
    child.data = encodeGeometryStruct(struct);
  });

  return writeRw(file);
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

/** A `numVertices × 4` prelit array filled with one colour. */
function fill(numVertices: number, [r, g, b, a]: Rgba): Uint8Array {
  const out = new Uint8Array(numVertices * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  return out;
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
