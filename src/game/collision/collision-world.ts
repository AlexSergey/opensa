import type { ModelColliders } from '../interfaces/collider.interface';

/**
 * Static-world collision for the current region, ready for a physics system
 * (Rapier — a later plan). Pure data: the bound collider models + their
 * placements, with no physics-engine dependency yet. The engine refills it via
 * `Game.loadColliders()` when a physics layer needs it, and clears it when the
 * region changes.
 */
export class CollisionWorld {
  /** The bound collider models (one entry per model, each with its placements). */
  get models(): readonly ModelColliders[] {
    return this.colliders;
  }

  /** Total placements across all models (one static body each, later). */
  get placementCount(): number {
    return this.colliders.reduce((sum, model) => sum + model.transforms.length, 0);
  }

  private colliders: ModelColliders[] = [];

  clear(): void {
    this.colliders = [];
  }

  set(colliders: ModelColliders[]): void {
    this.colliders = colliders;
  }
}
