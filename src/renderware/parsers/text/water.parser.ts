/** One water surface polygon (triangle or quad) — the corner positions only. */
export interface WaterQuad {
  /** Corner positions (GTA Z-up); 3 (triangle) or 4 (quad). */
  vertices: [number, number, number][];
}

/** Floats per vertex in a water.dat line: x, y, z + 4 normal/flow params. */
const FLOATS_PER_VERTEX = 7;
const MIN_VERTICES = 3;

/**
 * Parse `water.dat` into water surface polygons (positions only — enough for a
 * flat textured surface; the per-vertex normal/flow params and the trailing type
 * flag are ignored). Layout: a `processed` header line, then one polygon per line
 * as `vertexCount × (x y z + 4 params)` followed by a type flag; the vertex count
 * (3 or 4) is `(tokens − 1) / 7`. Blank/header lines are skipped.
 */
export function parseWater(text: string): WaterQuad[] {
  const quads: WaterQuad[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed === 'processed') {
      continue;
    }
    const tokens = trimmed.split(/\s+/).map(Number);
    const vertexCount = Math.floor((tokens.length - 1) / FLOATS_PER_VERTEX);
    if (vertexCount < MIN_VERTICES) {
      continue;
    }
    const vertices: [number, number, number][] = [];
    for (let v = 0; v < vertexCount; v += 1) {
      const o = v * FLOATS_PER_VERTEX;
      vertices.push([tokens[o], tokens[o + 1], tokens[o + 2]]);
    }
    quads.push({ vertices });
  }

  return quads;
}
