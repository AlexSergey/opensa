import type { Texture } from 'three';

import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';

import type { RWRoadsign } from '../parsers/binary/types';
import type { RenderPart } from './build-clump';

/**
 * 2dfx ROADSIGN text rendering (plan 042 item 5): one textured quad per character, UV-mapped
 * into the `roadsignfont` glyph atlas (particle.txd, 32×512, 4 columns × 32 rows of 8×16 px
 * cells — layout read off the texture itself).
 *
 * NB: unlike every other 2dfx entry, roadsign positions/rotations are baked in **WORLD space**
 * (verified empirically: entries land on real city locations — Grove Street at (2348, −1648) —
 * while their host road chunks are placed elsewhere; treating them as geometry-local threw the
 * quads off the map). So the parts here are world-space and must be added as static meshes with
 * an identity transform — NOT through the instanced path.
 */

/** Atlas cells 0–81 in reading order — ASCII with the "command" characters skipped. */
const ATLAS_ORDER = `!"&'()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]abcdefghijklmnopqrstuvwxyz{|}`;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 32;

/**
 * Command characters → appended glyph cells (82+: arrows, fractions, plane, icons). `<`/`>`/`^`/
 * `}`/`~` verified against vanilla (junction boards: plane on AIRPORT, down arrows on the lane
 * row); `#`/`%` read as the diagonal exit arrows — adjust HERE if a sign reads wrong.
 */
const COMMAND_GLYPHS: Readonly<Record<string, number>> = {
  '#': 87, // ↗
  '%': 86, // ↖
  '<': 82, // ←
  '>': 83, // →
  '^': 84, // ↑
  '}': 94, // airplane (AIRPORT boards)
  '~': 85, // ↓ (lane indicators on the boards' bottom row)
};

/** Text colour palette (flags bits 4–5): white, black, grey, red. */
const PALETTE: readonly number[] = [0xffffff, 0x000000, 0x808080, 0xb01010];

/** Lift the text off the board face to avoid z-fighting (metres, along the plate normal).
 *  Small on purpose: the per-side quad pair already covers boards whose face direction varies
 *  by rotation family — the correct-side quad hugs the board and the other one stays buried
 *  inside the plate (a bigger offset made the text visibly float off the face). */
const FACE_OFFSET = 0.05;

/** Text block inset: vanilla boards keep a margin — the glyph grid fills this share of the plate. */
const TEXT_INSET = 0.85;

const DEG_TO_RAD = Math.PI / 180;

/** The shared `roadsignfont` texture (particle.txd) — set once by the game shell at startup;
 *  while unset, sign text simply doesn't build (boards render bare, nothing crashes). */
let roadsignFont: null | Texture = null;

/**
 * Build the text quads for a model's road signs as render parts, batched by text colour (one
 * geometry + one alpha-tested font material per colour). Quads live in geometry-local space:
 * the plate is vertical (width along local X, height along Z — GTA Z-up), rotated by the
 * entry's XYZ degrees and lifted {@link FACE_OFFSET} off the board.
 */
export function buildRoadsignParts(roadsigns: readonly RWRoadsign[], font: Texture): RenderPart[] {
  const byColour = new Map<number, { positions: number[]; uvs: number[] }>();

  for (const sign of roadsigns) {
    let batch = byColour.get(sign.colour);
    if (!batch) {
      batch = { positions: [], uvs: [] };
      byColour.set(sign.colour, batch);
    }
    appendSignQuads(sign, batch.positions, batch.uvs);
  }

  const parts: RenderPart[] = [];
  for (const [colour, batch] of byColour) {
    if (batch.positions.length === 0) {
      continue;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(batch.positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(batch.uvs), 2));
    const index: number[] = [];
    for (let quad = 0; quad < batch.positions.length / 12; quad += 1) {
      const base = quad * 4;
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geometry.setIndex(index);
    geometry.computeVertexNormals(); // flat plate normals — kept for SSAO's normal prepass
    geometry.computeBoundingSphere();

    // DoubleSide on purpose: winding-vs-camera proved fragile across the rotation families
    // (FrontSide culled everything); the duplicated quads carry identical UVs, so they overlap
    // into one letterform and there is nothing to cull.
    const material = new MeshBasicMaterial({
      alphaTest: 0.3,
      color: PALETTE[colour] ?? PALETTE[0],
      map: font,
      side: DoubleSide,
      transparent: true,
    });
    material.name = 'roadsignfont';
    parts.push({ geometry, material });
  }

  return parts;
}

/** The installed glyph texture, or null when unavailable. */
export function getRoadsignFont(): null | Texture {
  return roadsignFont;
}

/** Glyph cell for a character, or null when it draws nothing (`_` = space) / is unknown. */
export function roadsignGlyphIndex(char: string): null | number {
  if (char === '_' || char === ' ') {
    return null;
  }
  const command = COMMAND_GLYPHS[char];
  if (command !== undefined) {
    return command;
  }
  const index = ATLAS_ORDER.indexOf(char);

  return index >= 0 ? index : null;
}

/** Install the `roadsignfont` glyph texture (call when particle.txd is loaded). */
export function setRoadsignFont(font: null | Texture): void {
  roadsignFont = font;
}

/** Append one sign's character quads (positions + UVs) to its colour batch. */
function appendSignQuads(sign: RWRoadsign, positions: number[], uvs: number[]): void {
  const [plateWidth, plateHeight] = sign.plateSize;
  const lineCount = sign.lines.length;
  const charWidth = (plateWidth * TEXT_INSET) / sign.charsPerLine;
  // Fixed quarter-plate line slots like vanilla — dividing by the actual line count stretched
  // 1–2-line boards into giant letters; the text block is centred vertically instead.
  const charHeight = (plateHeight * TEXT_INSET) / 4;

  // Plate local frame from the entry's XYZ degrees, applied **Z → X → Y** to the flat base
  // (width +X, lines advancing −Y, text normal −Z). This is the unique convention that renders
  // every rotation family observed in the map upright and readable — brute-forced over Euler
  // orders × angle signs × base triads by `scripts/solve-roadsign.ts` and verified in-game
  // (plan 042 item 5; the X→Y→Z guess looked right on ±90/0/180 boards but rolled the
  // (±90,±90,±90) family by 90°).
  const [rx, ry, rz] = sign.rotation.map((deg) => deg * DEG_TO_RAD);
  const rotate = composeRotation(rx, ry, rz);

  for (let line = 0; line < lineCount; line += 1) {
    const text = sign.lines[line];
    const top = (lineCount * charHeight) / 2 - line * charHeight;
    for (let column = 0; column < Math.min(sign.charsPerLine, text.length); column += 1) {
      const glyph = roadsignGlyphIndex(text[column]);
      if (glyph === null) {
        continue;
      }
      const left = (-plateWidth * TEXT_INSET) / 2 + column * charWidth;
      // The SAME glyph quad at ±offset: the board's face direction varies by rotation family,
      // so one copy hugs the visible face while the other stays buried inside the plate (the
      // desert-signs-invisible bug). Identical UVs — the copies overlap into one letterform
      // (readable from the board's front; mirrored from behind, like vanilla).
      for (const offset of [-FACE_OFFSET, FACE_OFFSET]) {
        const corners = [
          [left, top, offset],
          [left, top - charHeight, offset],
          [left + charWidth, top - charHeight, offset],
          [left + charWidth, top, offset],
        ];
        for (const [x, y, z] of corners) {
          const [wx, wy, wz] = rotate(x, y, z);
          positions.push(sign.position[0] + wx, sign.position[1] + wy, sign.position[2] + wz);
        }
        const cellU = (glyph % ATLAS_COLS) / ATLAS_COLS;
        const cellV = Math.floor(glyph / ATLAS_COLS) / ATLAS_ROWS;
        // DFF-style v-down UVs (same convention the TXD pipeline renders everywhere else).
        uvs.push(
          cellU,
          cellV,
          cellU,
          cellV + 1 / ATLAS_ROWS,
          cellU + 1 / ATLAS_COLS,
          cellV + 1 / ATLAS_ROWS,
          cellU + 1 / ATLAS_COLS,
          cellV,
        );
      }
    }
  }
}

/** Rotation Z→X→Y (radians) as a point transformer — allocation-free per corner.
 *  The order is solver-verified (scripts/solve-roadsign.ts) across every observed sign family. */
function composeRotation(
  rx: number,
  ry: number,
  rz: number,
): (x: number, y: number, z: number) => [number, number, number] {
  const [sx, cx] = [Math.sin(rx), Math.cos(rx)];
  const [sy, cy] = [Math.sin(ry), Math.cos(ry)];
  const [sz, cz] = [Math.sin(rz), Math.cos(rz)];

  return (x, y, z) => {
    // Z axis
    const x1 = x * cz - y * sz;
    const y1 = x * sz + y * cz;
    // X axis
    const y2 = y1 * cx - z * sx;
    const z2 = y1 * sx + z * cx;
    // Y axis
    const x3 = x1 * cy + z2 * sy;
    const z3 = -x1 * sy + z2 * cy;

    return [x3, y2, z3];
  };
}
