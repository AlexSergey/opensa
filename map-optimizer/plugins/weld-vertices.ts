import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/** One per-vertex attribute array being compacted (its source, component count, and write-back). */
interface Channel {
  commit: (mesh: SubMesh, values: number[]) => void;
  out: number[];
  src: ArrayLike<number>;
  stride: number;
}

/**
 * Merge vertices that are identical in **all** attributes (position + normal + UV + prelit + night) and
 * re-index the triangles. Purely removes redundant duplicate vertices — no visual change — and exercises the
 * count-changing re-encoder (plan 004). A no-op when nothing merges (counts unchanged → faithful path).
 */
export function createWeldVertices(): MapPlugin {
  return {
    name: 'weld-vertices',
    transform(asset, context): void {
      let removed = 0;
      for (const mesh of asset.ir.meshes) {
        removed += weldMesh(mesh);
      }
      if (removed > 0) {
        asset.dirty = true;
        context.log(asset, 'weld-vertices', `merged ${removed} duplicate vertices`);
      }
    },
  };
}

/** Weld one sub-mesh in place; returns the number of vertices removed (0 = unchanged). */
export function weldMesh(mesh: SubMesh): number {
  const vertexCount = mesh.positions.length / 3;
  const channels = collectChannels(mesh);
  const keyToNew = new Map<string, number>();
  const oldToNew = new Int32Array(vertexCount);
  let next = 0;

  for (let v = 0; v < vertexCount; v += 1) {
    const key = vertexKey(channels, v);
    let mapped = keyToNew.get(key);
    if (mapped === undefined) {
      mapped = next;
      next += 1;
      keyToNew.set(key, mapped);
      for (const channel of channels) {
        appendVertex(channel, v);
      }
    }
    oldToNew[v] = mapped;
  }

  if (next === vertexCount) {
    return 0; // no duplicates
  }

  for (const channel of channels) {
    channel.commit(mesh, channel.out);
  }
  mesh.triangles = mesh.triangles.map(
    (triangle): Triangle => ({
      a: oldToNew[triangle.a],
      b: oldToNew[triangle.b],
      c: oldToNew[triangle.c],
      material: triangle.material,
    }),
  );

  return vertexCount - next;
}

function appendVertex(channel: Channel, vertex: number): void {
  for (let i = 0; i < channel.stride; i += 1) {
    channel.out.push(channel.src[vertex * channel.stride + i]);
  }
}

/** The per-vertex attribute channels present on a mesh (position is always first). */
function collectChannels(mesh: SubMesh): Channel[] {
  const channels: Channel[] = [
    { commit: (m, values) => void (m.positions = new Float32Array(values)), out: [], src: mesh.positions, stride: 3 },
  ];
  if (mesh.normals) {
    channels.push({
      commit: (m, values) => void (m.normals = new Float32Array(values)),
      out: [],
      src: mesh.normals,
      stride: 3,
    });
  }
  if (mesh.uvs) {
    channels.push({
      commit: (m, values) => void (m.uvs = new Float32Array(values)),
      out: [],
      src: mesh.uvs,
      stride: 2,
    });
  }
  if (mesh.prelitColors) {
    channels.push({
      commit: (m, values) => void (m.prelitColors = new Uint8Array(values)),
      out: [],
      src: mesh.prelitColors,
      stride: 4,
    });
  }
  if (mesh.nightColors) {
    channels.push({
      commit: (m, values) => void (m.nightColors = new Uint8Array(values)),
      out: [],
      src: mesh.nightColors,
      stride: 4,
    });
  }

  return channels;
}

/** All-attribute key — only fully-identical vertices share it (so welding is visually lossless). */
function vertexKey(channels: readonly Channel[], vertex: number): string {
  const parts: number[] = [];
  for (const channel of channels) {
    for (let i = 0; i < channel.stride; i += 1) {
      parts.push(channel.src[vertex * channel.stride + i]);
    }
  }

  return parts.join(',');
}
