import { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { CellFader } from './fade';

/** A mesh with one opaque material (the common streamed-cell case). */
function opaqueMesh(): { material: MeshStandardMaterial; mesh: Mesh } {
  const material = new MeshStandardMaterial();

  return { material, mesh: new Mesh(undefined, material) };
}

describe('CellFader', () => {
  describe('negative cases', () => {
    it('does not complete (or restore) before the duration elapses', () => {
      const { material, mesh } = opaqueMesh();
      const fader = new CellFader();
      fader.start('a', [mesh]);
      fader.update(0.1); // < 0.4s duration
      expect(material.transparent).toBe(true); // still mid-fade
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(1);
    });

    it('cancel restores the original state without finishing the ramp', () => {
      const { material, mesh } = opaqueMesh();
      const fader = new CellFader();
      fader.start('a', [mesh]);
      fader.update(0.1);
      fader.cancel('a');
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
      fader.update(1); // no longer tracked → no further changes
      expect(material.opacity).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('zeroes opacity and marks the material transparent on start', () => {
      const { material, mesh } = opaqueMesh();
      new CellFader().start('a', [mesh]);
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBe(0);
    });

    it('restores opaque state once the fade completes', () => {
      const { material, mesh } = opaqueMesh();
      const fader = new CellFader();
      fader.start('a', [mesh]);
      fader.update(0.4);
      expect(material.opacity).toBe(1);
      expect(material.transparent).toBe(false);
    });

    it('keeps a translucent material translucent, ramping to its original opacity', () => {
      const material = new MeshStandardMaterial({ opacity: 0.5, transparent: true });
      const mesh = new Mesh(undefined, material);
      const fader = new CellFader();
      fader.start('glass', [mesh]);
      expect(material.opacity).toBe(0);
      fader.update(0.4);
      expect(material.opacity).toBe(0.5);
      expect(material.transparent).toBe(true);
    });
  });
});
