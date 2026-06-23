import type { MapPlugin } from '../core/asset';
import type { Triangle } from '../core/ir';

/**
 * Remove zero-area triangles — coincident/collinear corners, or the equal-index faces welding can create.
 * They render nothing but cost index/BinMesh space (plan 007). A triangle-count change → rides the
 * count-changing re-encoder; `prune-vertices` afterwards reclaims any orphaned vertices.
 */

const DEFAULT_EPSILON = 1e-6;

export interface DegenerateTrianglesOptions {
  /** A face is degenerate when its cross-product magnitude (≈ 2·area) is below this. Default 1e-6. */
  epsilon?: number;
}

export function createRemoveDegenerateTriangles(options: DegenerateTrianglesOptions = {}): MapPlugin {
  return {
    name: 'remove-degenerate-triangles',
    transform(asset, context): void {
      let removed = 0;
      for (const mesh of asset.ir.meshes) {
        const before = mesh.triangles.length;
        const kept = removeDegenerateTriangles(mesh.positions, mesh.triangles, options.epsilon);
        if (kept.length < before) {
          mesh.triangles = kept;
          removed += before - kept.length;
        }
      }
      if (removed > 0) {
        asset.dirty = true;
        context.log(asset, 'remove-degenerate-triangles', `removed ${removed} degenerate faces`);
      }
    },
  };
}

/** Keep only triangles with area above `epsilon`. */
export function removeDegenerateTriangles(
  positions: Float32Array,
  triangles: readonly Triangle[],
  epsilon: number = DEFAULT_EPSILON,
): Triangle[] {
  return triangles.filter((triangle) => crossMagnitude(positions, triangle) >= epsilon);
}

/** |(B−A) × (C−A)| — twice the triangle's area; 0 for coincident/collinear/equal-index corners. */
function crossMagnitude(positions: Float32Array, triangle: Triangle): number {
  const ax = positions[triangle.a * 3];
  const ay = positions[triangle.a * 3 + 1];
  const az = positions[triangle.a * 3 + 2];
  const bx = positions[triangle.b * 3] - ax;
  const by = positions[triangle.b * 3 + 1] - ay;
  const bz = positions[triangle.b * 3 + 2] - az;
  const cx = positions[triangle.c * 3] - ax;
  const cy = positions[triangle.c * 3 + 1] - ay;
  const cz = positions[triangle.c * 3 + 2] - az;

  return Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx);
}
