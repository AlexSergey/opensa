import type { MaterialReport, ProcessOptions, VehicleAdapter, VehicleReport } from '../../core/types';

import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
import { copyMaterialEffects } from './copy-effects';
import { scaleDff } from './scale';

/**
 * GTA-SA (RenderWare) vehicle adapter, operating on DFF **bytes** (the CLI reads/writes files). `inspect` is
 * implemented (read-only reuse of the DFF parser); `process` does the uniform scale (plan 002) and will copy
 * reflection/specular/env-map from a prototype (plan 003 — stubbed). Output stays standard RenderWare, so it
 * runs in the real game.
 */
export function createGtaSaVehicleAdapter(): VehicleAdapter {
  return {
    inspect(dff: Uint8Array, name: string): VehicleReport {
      const clump = parseDff(toArrayBuffer(dff));
      let vertices = 0;
      let triangles = 0;
      const materials: MaterialReport[] = [];
      for (const geometry of clump.geometries) {
        vertices += geometry.positions.length / 3;
        triangles += geometry.triangles.length;
        for (const material of geometry.materials) {
          materials.push({
            envMap: Boolean(material.effects?.envMap),
            reflection: Boolean(material.effects?.reflection),
            specular: Boolean(material.effects?.specular),
            texture: material.texture?.name.toLowerCase() ?? '',
          });
        }
      }

      return {
        dummies: clump.frames.map((frame) => frame.name).filter(Boolean),
        frames: clump.frames.length,
        geometries: clump.geometries.length,
        materials,
        model: name,
        triangles,
        vertices,
      };
    },
    process(dff: Uint8Array, options: ProcessOptions): Uint8Array {
      let bytes = dff;
      if (options.scale && options.scale !== 1) {
        bytes = scaleDff(bytes, options.scale);
      }
      if (options.prototype) {
        bytes = copyMaterialEffects(bytes, options.prototype);
      }

      return bytes;
    },
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
