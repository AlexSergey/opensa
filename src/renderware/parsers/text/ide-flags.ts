import type { IdeObjectDef } from './types';

/**
 * SA IDE object-definition flag bits (the 4th `objs`/`tobj` column; plan 039). The engine reads
 * these per model def. Render-relevant bits are implemented in the map pipeline; gameplay bits are
 * listed for reference and intentionally skipped (see the plan's table for the full map).
 *
 * Semantics rule: a bit is only acted on after being verified against a real asset (the
 * trafficlight1 method — plan 004), since community documentation of the middle bits is fuzzy.
 */
export const IdeFlag = {
  /** 0x8 — additive blending (lamp glow cards, neon); implies {@link IdeFlag.DRAW_LAST}. */
  ADDITIVE: 0x8,
  /** 0x200000 — render double-sided (verified: trafficlight1, dynamic.ide flags 2130048). */
  DISABLE_BACKFACE_CULLING: 0x200000,
  /** 0x4 — render in the sorted alpha list (transparent, drawn after opaque). */
  DRAW_LAST: 0x4,
  /** 0x4000 — palm: wind sway (longer/slower than trees). */
  IS_PALM: 0x4000,
  /** 0x2000 — tree: wind sway. */
  IS_TREE: 0x2000,
  /** 0x40 — don't write the depth buffer (alpha decals). */
  NO_ZBUFFER_WRITE: 0x40,
} as const;

/** Whether an object def carries the given {@link IdeFlag} bit. */
export function hasIdeFlag(def: Pick<IdeObjectDef, 'flags'>, flag: number): boolean {
  return (def.flags & flag) !== 0;
}
