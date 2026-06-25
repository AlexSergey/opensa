import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDff } from '../parsers/binary/dff';
import { parseIfp } from '../parsers/binary/ifp';
import { toArrayBuffer } from '../test-utils';
import { buildAnimatedClump } from './build-animated-clump';

// Real IDE `anim` object (counxref.ide: `3426, nt_noddonkbase, des_xoilfield, counxref, 200, 0x200000`):
// the oil-field nodding donkey — a 6-frame clump whose looping clip lives in counxref.ifp.
const PUMP_DFF = 'tests/original/dff/anim-clump/nt_noddonkbase.dff';
const PUMP_IFP = 'tests/original/dff/anim-clump/counxref.ifp';

function load(path: string): ArrayBuffer {
  return toArrayBuffer(new Uint8Array(readFileSync(path)));
}

function pump(): ReturnType<typeof buildAnimatedClump> {
  return buildAnimatedClump(parseDff(load(PUMP_DFF)), 'nt_noddonkbase', parseIfp(load(PUMP_IFP)));
}

describe('buildAnimatedClump', () => {
  describe('negative cases', () => {
    it('returns a null clip when the IFP package has no animation named after the model', () => {
      const built = buildAnimatedClump(parseDff(load(PUMP_DFF)), 'nt_noddonkbase', []);
      expect(built.clip).toBeNull();
      expect(built.root.children.length).toBeGreaterThan(0); // still renders, static
    });
  });

  describe('positive cases', () => {
    it('keeps the DFF frame hierarchy — named nodes with their local transforms', () => {
      const { root } = pump();
      // Byte-verified hierarchy: root frame → nt_noddonkbase → Object02/04/01, Object03 under Object01.
      const arm = root.getObjectByName('Object01');
      const head = root.getObjectByName('Object03');
      expect(arm).toBeDefined();
      expect(head?.parent?.name).toBe('Object01');
      expect(root.getObjectByName('Object02')?.parent?.name).toBe('nt_noddonkbase');
      // Frame transforms KEPT (unlike the instanced map path): Object02 sits at (−0.33, 9.89, 14.46).
      const lift = root.getObjectByName('Object02');
      expect(lift?.position.length() ?? 0).toBeGreaterThan(1);
    });

    it('hangs one unlit world-material mesh per atomic under its frame node', () => {
      const { materials, root } = pump();
      let meshes = 0;
      root.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) {
          meshes += 1;
        }
      });
      expect(meshes).toBe(5); // byte-verified atomic count
      expect(materials.length).toBeGreaterThan(0);
      expect(materials.every((material) => material.isMeshBasicMaterial)).toBe(true);
    });

    it('builds the looping clip with tracks bound to existing frame-node names', () => {
      const { clip, root } = pump();
      expect(clip).not.toBeNull();
      expect(clip?.name).toBe('nt_noddonkbase');
      expect(clip?.tracks.length).toBeGreaterThan(0);
      for (const track of clip?.tracks ?? []) {
        const nodeName = track.name.split('.')[0];
        expect(root.getObjectByName(nodeName), `track target ${track.name}`).toBeDefined();
      }
    });
  });
});
