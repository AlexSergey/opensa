import type { CarGroup, IplCarGenerator, PopcycleZone } from '@opensa/renderware';

import { popcycleSlotForHour } from '@opensa/renderware';

import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';

export interface RandomCarPlacementOptions {
  /** Gate (lowercased model → keep) — e.g. reject models with no `vehicles.ide` entry. */
  accept: (model: string) => boolean;
  cargrp: readonly CarGroup[];
  /** Game hour 0–23 at resolve time (these static cars decide their model once, at load). */
  hour: number;
  /** Resolve a position to its zone-type population cycle (the city approximation), or null to skip it. */
  popcycleFor: (position: readonly [number, number, number]) => null | PopcycleZone;
  weekend?: boolean;
}

export interface RandomCarQuery {
  /** Optional gate (lowercased model → keep) — e.g. reject models with no `vehicles.ide` entry. */
  accept?: (model: string) => boolean;
  /** All `cargrp.dat` groups; the 18 `POPCYCLE_GROUP_*` ones are used, index-aligned to the weights. */
  cargrp: readonly CarGroup[];
  /** Game hour 0–23. */
  hour: number;
  /** The zone-type's population cycle (from `parsePopcycle`). */
  popcycle: PopcycleZone;
  /** Deterministic seed (e.g. a quantised position) — the same generator always picks the same car. */
  seed: number;
  weekend: boolean;
}

/** A stable integer seed from a world position (quantised to ~1 m) — a generator always picks the same car. */
export function positionSeed(position: readonly [number, number, number]): number {
  let hash = 0x811c9dc5;
  for (const axis of position) {
    const value = Math.round(axis) | 0;
    hash = Math.imul(hash ^ (value & 0xffff), 0x01000193);
    hash = Math.imul(hash ^ ((value >>> 16) & 0xffff), 0x01000193);
  }

  return hash >>> 0;
}

/**
 * Pick an ambient car model for a zone-type at a game hour, the SA way: weight the 18 population groups by the
 * popcycle slot, choose one (seeded), then a random model from that `cargrp` group (seeded). Deterministic for a
 * given seed. Returns null when the slot has no weighted group or the chosen group is empty / all-rejected.
 */
export function randomCarModel(query: RandomCarQuery): null | string {
  const slot = (query.weekend ? query.popcycle.weekend : query.popcycle.weekday)[popcycleSlotForHour(query.hour)];
  if (!slot) {
    return null;
  }
  const groups = query.cargrp.filter((group) => group.comment.startsWith('POPCYCLE_GROUP_'));
  const rng = mulberry32(query.seed);
  const groupIndex = weightedPick(slot.groupWeights, rng());
  if (groupIndex < 0) {
    return null;
  }
  const models = (groups[groupIndex]?.models ?? []).filter((model) => query.accept?.(model) ?? true);

  return models.length === 0 ? null : models[Math.floor(rng() * models.length)];
}

/**
 * Build {@link VehiclePlacement}s for the **random** (`id = -1`) car generators: resolve each via its zone-type
 * popcycle weights → a cargrp model, seeded by position (so it's stable across reloads). Generators with a
 * specific model id are ignored here (handled by `carGeneratorPlacements`); a generator whose position has no
 * resolvable zone-type, or whose pick yields no model, is skipped. Heading = the IPL angle; colour is left to the
 * spawner (these generators ship random colours).
 */
export function randomCarPlacements(
  generators: readonly IplCarGenerator[],
  options: RandomCarPlacementOptions,
): VehiclePlacement[] {
  const placements: VehiclePlacement[] = [];
  for (const generator of generators) {
    if (generator.id !== -1) {
      continue;
    }
    const popcycle = options.popcycleFor(generator.position);
    if (popcycle === null) {
      continue;
    }
    const model = randomCarModel({
      accept: options.accept,
      cargrp: options.cargrp,
      hour: options.hour,
      popcycle,
      seed: positionSeed(generator.position),
      weekend: options.weekend ?? false,
    });
    if (model !== null) {
      placements.push({ groundSnap: true, heading: generator.angle, model, position: [...generator.position] });
    }
  }

  return placements;
}

/** A small deterministic PRNG (mulberry32) → a function yielding floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index of the weighted choice for `r` in [0, 1); -1 when every weight is zero. */
function weightedPick(weights: readonly number[], r: number): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) {
    return -1;
  }
  let threshold = r * total;
  for (let i = 0; i < weights.length; i += 1) {
    threshold -= Math.max(0, weights[i]);
    if (threshold < 0) {
      return i;
    }
  }

  return weights.length - 1;
}
