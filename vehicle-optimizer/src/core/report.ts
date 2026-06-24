import type { VehicleReport } from './types';

/** Print a vehicle structure report — what scaling touches (parts + rig) and which materials carry effects. */
export function printReport(report: VehicleReport): void {
  console.log(`vehicle-optimizer — ${report.model}`);
  console.log(`  geometry  — ${report.geometries} parts, ${report.vertices} verts, ${report.triangles} tris`);
  console.log(`  rig       — ${report.frames} frames (${report.dummies.length} named dummies)`);

  const effects = report.materials.filter((m) => m.envMap || m.reflection || m.specular);
  console.log(`  materials — ${report.materials.length} total, ${effects.length} with reflective effects`);
  for (const material of effects) {
    const tags = [material.envMap && 'env', material.reflection && 'refl', material.specular && 'spec']
      .filter(Boolean)
      .join('+');
    console.log(`    ${material.texture || '(untextured)'} — ${tags}`);
  }
}
