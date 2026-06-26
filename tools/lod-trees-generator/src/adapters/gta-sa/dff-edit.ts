import { readRw, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';

const RW_STRUCT = 0x01;
const RW_STRING = 0x02;
const RW_EXTENSION = 0x03;
const RW_TEXTURE = 0x06;
const RW_MATERIAL = 0x07;
const RW_MATERIAL_LIST = 0x08;
const HEADER = 12;
const GEOMETRY_TRISTRIP = 0x01; // rpGEOMETRYTRISTRIP — flags bit 0 of the geometry Struct
const EXTRA_VERT_COLOUR = 0x253f2f9; // rpEXTRAVERTCOLOUR — one RGBA per vertex (SA day/night blend)

/**
 * Clear the geometry's tristrip flag. The template clump we rebuild over is tristrip, but the card geometry is
 * written as a triangle **list** (BinMesh prim 0); leaving the flag set makes RenderWare/SA read the list as a
 * strip and draw nothing (our lenient viewer renders it anyway). Mirrors what the stock/Proper-Fixes LOD DFFs do.
 */
export function clearTristripFlag(dff: Uint8Array): Uint8Array {
  const file = readRw(dff);
  for (const geometry of collectGeometries(file.chunks)) {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT);
    if (struct?.data && struct.data.length >= 2) {
      const data = struct.data.slice(); // flags is the u16 at offset 0; bit 0 = tristrip
      data[0] &= ~GEOMETRY_TRISTRIP;
      struct.data = data;
    }
  }

  return writeRw(file);
}

/**
 * Drop the geometry's **extra-vertex-colour** extension. The template clump we rebuild over keeps this plugin
 * with the *template's* per-vertex colours (one RGBA per template vertex), but our card geometry has a different
 * vertex count — so SA reads the stale, oversized colour array against our vertices and the geometry renders
 * black/transparent (our viewer ignores the plugin). Removing it lets SA fall back to the geometry's prelit.
 */
export function stripExtraVertColour(dff: Uint8Array): Uint8Array {
  const file = readRw(dff);
  for (const geometry of collectGeometries(file.chunks)) {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    if (extension?.children) {
      extension.children = extension.children.filter((child) => child.type !== EXTRA_VERT_COLOUR);
    }
  }

  return writeRw(file);
}

// MaterialList/Material/Texture are leaves to the rw-codec reader, so we walk their raw blob ourselves.
const CONTAINERS = new Set([RW_MATERIAL, RW_MATERIAL_LIST, RW_TEXTURE]);

/** Set every material's texture **name + mask** in a DFF to `name` (so the LOD references its atlas entry). */
export function setTextureName(dff: Uint8Array, name: string): Uint8Array {
  const file = readRw(dff);
  for (const geometry of collectGeometries(file.chunks)) {
    const materialList = geometry.children?.find((child) => child.type === RW_MATERIAL_LIST);
    if (materialList?.data) {
      materialList.data = rewrite(materialList.data, name, false);
    }
  }

  return writeRw(file);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function encodeRwString(name: string): Uint8Array {
  const length = Math.ceil((name.length + 1) / 4) * 4; // include NUL, pad to 4
  const out = new Uint8Array(length);
  for (let i = 0; i < name.length; i += 1) {
    out[i] = name.charCodeAt(i);
  }

  return out;
}

/** Recursively rewrite a material-list blob: replace STRING bodies that sit inside a TEXTURE chunk. */
function rewrite(data: Uint8Array, name: string, inTexture: boolean): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Uint8Array[] = [];
  let pos = 0;
  while (pos + HEADER <= data.length) {
    const type = view.getUint32(pos, true);
    const size = view.getUint32(pos + 4, true);
    const version = view.getUint32(pos + 8, true);
    const body = data.subarray(pos + HEADER, pos + HEADER + size);

    let newBody = body;
    if (type === RW_STRING && inTexture) {
      newBody = encodeRwString(name);
    } else if (CONTAINERS.has(type)) {
      newBody = rewrite(body, name, type === RW_TEXTURE);
    }

    const head = new Uint8Array(HEADER);
    const headView = new DataView(head.buffer);
    headView.setUint32(0, type, true);
    headView.setUint32(4, newBody.length, true);
    headView.setUint32(8, version, true);
    parts.push(head, newBody);
    pos += HEADER + size;
  }

  return concat(parts);
}
