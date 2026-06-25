import type { Material, Object3D } from 'three';

/** Seconds a freshly-streamed cell takes to fade in. */
const FADE_DURATION = 0.4;

interface CellFade {
  elapsed: number;
  materials: MaterialState[];
}

/** A material's pre-fade state, restored once the fade completes (the cell mesh is cached). */
interface MaterialState {
  material: Material;
  opacity: number;
  transparent: boolean;
}

/**
 * Fades freshly-streamed cells in by ramping their materials' opacity from 0 to
 * the original, so new map sections don't pop in. Materials are per-cell (not
 * shared across cells), so this never touches other sections. Genuinely
 * translucent materials keep their original opacity/`transparent` flag — the
 * fade multiplies their opacity and is restored on completion (or on cancel, when
 * a cell unloads mid-fade, since the cell's meshes stay cached and get reused).
 */
export class CellFader {
  private readonly fades = new Map<string, CellFade>();

  /** Stop fading a cell (it unloaded) and restore its materials immediately. */
  cancel(key: string): void {
    const fade = this.fades.get(key);
    if (fade) {
      restore(fade);
      this.fades.delete(key);
    }
  }

  /** Begin fading a cell's objects in (records + zeroes each material's opacity). */
  start(key: string, objects: readonly Object3D[]): void {
    this.cancel(key); // a stale fade for this key would otherwise leak its original state
    const materials = collectMaterials(objects);
    if (materials.length === 0) {
      return;
    }
    for (const state of materials) {
      if (!state.material.transparent) {
        state.material.transparent = true;
        state.material.needsUpdate = true; // toggling `transparent` re-evaluates the program
      }
      state.material.opacity = 0;
    }
    this.fades.set(key, { elapsed: 0, materials });
  }

  /** Advance all fades; restore materials to their original state once done. */
  update(delta: number): void {
    for (const [key, fade] of this.fades) {
      fade.elapsed += delta;
      const t = Math.min(fade.elapsed / FADE_DURATION, 1);
      for (const state of fade.materials) {
        state.material.opacity = state.opacity * t;
      }
      if (t >= 1) {
        restore(fade);
        this.fades.delete(key);
      }
    }
  }
}

/** Unique materials of the given objects, with their current (original) opacity/transparent. */
function collectMaterials(objects: readonly Object3D[]): MaterialState[] {
  const seen = new Set<Material>();
  const states: MaterialState[] = [];
  for (const object of objects) {
    object.traverse((node) => {
      const material = (node as { material?: Material | Material[] }).material;
      if (!material) {
        return;
      }
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (!seen.has(entry)) {
          seen.add(entry);
          states.push({ material: entry, opacity: entry.opacity, transparent: entry.transparent });
        }
      }
    });
  }

  return states;
}

function restore(fade: CellFade): void {
  for (const state of fade.materials) {
    state.material.opacity = state.opacity;
    if (state.material.transparent !== state.transparent) {
      state.material.transparent = state.transparent;
      state.material.needsUpdate = true;
    }
  }
}
