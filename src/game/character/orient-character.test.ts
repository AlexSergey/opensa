import { BoxGeometry, Mesh } from 'three';
import { describe, expect, it } from 'vitest';

import { orientCharacter } from './orient-character';

function boxModel(): Mesh {
  return new Mesh(new BoxGeometry(0.5, 1.8, 0.3));
}

describe('orientCharacter', () => {
  describe('positive cases', () => {
    it('wraps the model and applies the placement rotation + scale', () => {
      const model = boxModel();
      const wrapper = orientCharacter(model, { rotation: [Math.PI / 2, 0, 0], scale: 2 });

      expect(wrapper.children).toEqual([model]);
      expect(model.rotation.x).toBeCloseTo(Math.PI / 2);
      expect(model.scale.x).toBe(2);
    });

    it('applies the offset to the model position (default zero)', () => {
      const offset = orientCharacter(boxModel(), { offset: [0, 0, -0.07], rotation: [0, 0, 0], scale: 1 });
      expect(offset.children[0].position.toArray()).toEqual([0, 0, -0.07]);

      const noOffset = orientCharacter(boxModel(), { rotation: [0, 0, 0], scale: 1 });
      expect(noOffset.children[0].position.toArray()).toEqual([0, 0, 0]);
    });
  });
});
