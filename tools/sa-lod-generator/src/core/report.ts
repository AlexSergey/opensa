import type { LodLink, ResolveResult } from './types';

/**
 * Phase-1 sizing report — the "compare with the existing old LODs" numbers, before any baking. `farView*` sums a
 * triangle over **every LOD render** (per instance): the map-wide far-view budget stock LODs vs full HD clones.
 * `layer*` sums each **distinct** model once: the LOD-layer geometry that ships in the img (stream/size proxy).
 */
export interface SizingReport {
  farViewCloneTris: number;
  farViewStockTris: number;
  hdModels: number;
  layerCloneTris: number;
  layerStockTris: number;
  /** Total HD instances that carry a LOD link (resolved). */
  links: number;
  lodModels: number;
  /** LOD models mapped to exactly one HD model — Phase 1 clones these. */
  perObjectLods: number;
  /** LOD models mapped to several HD models (area-shared) — Phase 1 skips these (kept stock). */
  sharedLods: number;
  unresolved: number;
}

/**
 * Links whose LOD maps to **exactly one** HD model (1:1) — Phase 1 clones only these. A LOD referenced by several
 * HD models (area-shared) has no single HD to clone, so it's left stock (see `docs/plans/002`).
 */
export function perObjectLinks(links: readonly LodLink[]): LodLink[] {
  const hdCount = new Map<string, number>(); // lodModel → distinct HD models linking to it
  for (const link of links) {
    hdCount.set(link.lodModel, (hdCount.get(link.lodModel) ?? 0) + 1);
  }

  return links.filter((link) => hdCount.get(link.lodModel) === 1);
}

export function printReport(game: string, report: SizingReport): void {
  const x = (a: number, b: number): string => (b > 0 ? `${(a / b).toFixed(1)}x` : '—');
  console.log(`sa-lod-generator ${game}:`);
  console.log(`  LOD links      — ${report.links.toLocaleString()} HD instances (${report.unresolved} unresolved)`);
  console.log(
    `  LOD models     — ${report.lodModels} (per-object ${report.perObjectLods}, shared ${report.sharedLods} → Phase 1 skips shared)`,
  );
  console.log(`  HD models LOD'd — ${report.hdModels}`);
  console.log(
    `  far-view tris  — stock ${report.farViewStockTris.toLocaleString()} → clone ${report.farViewCloneTris.toLocaleString()} (${x(report.farViewCloneTris, report.farViewStockTris)})`,
  );
  console.log(
    `  LOD-layer tris — stock ${report.layerStockTris.toLocaleString()} → clone ${report.layerCloneTris.toLocaleString()} (${x(report.layerCloneTris, report.layerStockTris)})`,
  );
}

/** Summarize resolved links into a {@link SizingReport}, using a per-model triangle count (adapter-provided). */
export function summarize(resolved: ResolveResult, tris: (model: string) => number): SizingReport {
  const hdOf = new Map<string, Set<string>>(); // lodModel → the HD models that link to it
  const lodModels = new Set<string>();
  const hdModels = new Set<string>();
  let farViewStockTris = 0;
  let farViewCloneTris = 0;
  let links = 0;
  for (const link of resolved.links) {
    lodModels.add(link.lodModel);
    hdModels.add(link.hdModel);
    const set = hdOf.get(link.lodModel) ?? new Set<string>();
    set.add(link.hdModel);
    hdOf.set(link.lodModel, set);
    farViewStockTris += link.instanceCount * tris(link.lodModel);
    farViewCloneTris += link.instanceCount * tris(link.hdModel);
    links += link.instanceCount;
  }

  let perObjectLods = 0;
  let sharedLods = 0;
  for (const set of hdOf.values()) {
    if (set.size === 1) {
      perObjectLods += 1;
    } else {
      sharedLods += 1;
    }
  }

  let layerStockTris = 0;
  let layerCloneTris = 0;
  for (const model of lodModels) {
    layerStockTris += tris(model);
  }
  for (const model of hdModels) {
    layerCloneTris += tris(model);
  }

  return {
    farViewCloneTris,
    farViewStockTris,
    hdModels: hdModels.size,
    layerCloneTris,
    layerStockTris,
    links,
    lodModels: lodModels.size,
    perObjectLods,
    sharedLods,
    unresolved: resolved.unresolved,
  };
}
