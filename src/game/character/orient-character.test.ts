import { Box3, BoxGeometry, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { orientCharacter } from './orient-character';

/** A 0.5 (x) × 1.8 (y) × 0.3 (z) box centred on the origin — a stand-in model. */
function boxModel(): Mesh {
  return new Mesh(new BoxGeometry(0.5, 1.8, 0.3));
}

describe('orientCharacter', () => {
  describe('positive cases', () => {
    it('wraps the model and applies the placement rotation + scale', () => {
      const model = boxModel();
      const wrapper = orientCharacter(model, { rotation: [Math.PI / 2, 0, 0], scale: 2 }, 0.9);

      expect(wrapper.children).toEqual([model]);
      expect(model.rotation.x).toBeCloseTo(Math.PI / 2);
      expect(model.scale.x).toBe(2);
    });

    it('drops the model feet (min Z) to the box base and centres it horizontally', () => {
      const model = boxModel();
      const boxHalfZ = 0.9;
      const wrapper = orientCharacter(model, { rotation: [0, 0, 0], scale: 1 }, boxHalfZ);
      wrapper.updateMatrixWorld(true);

      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      expect(bounds.min.z).toBeCloseTo(-boxHalfZ); // feet at the box base
      expect(center.x).toBeCloseTo(0);
      expect(center.y).toBeCloseTo(0);
    });
  });
});
