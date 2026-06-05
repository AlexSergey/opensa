import { describe, expect, it } from 'vitest';

import { buildArchiveBuffer, openArchive } from '../archive/img-archive';
import { concat, f32a, fixedString, u8, u16, u32 } from '../test-utils';
import { buildCollisionIndex, getCollision } from './collision-index';

function archiveWith(entries: { data: Uint8Array; name: string }[]): ReturnType<typeof openArchive> {
  return openArchive(buildArchiveBuffer(entries));
}

function colLibrary(models: { modelId: number; name: string }[]): Uint8Array {
  return concat(...models.map((m) => colModel(m.name, m.modelId)));
}

/** A minimal header-only COL2 model: 0 spheres/boxes/faces, so no data section is read. */
function colModel(name: string, modelId: number): Uint8Array {
  const body = concat(
    fixedString(name, 22),
    u16(modelId),
    f32a([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // bounds: min(3) max(3) center(3) radius(1)
    u16(0), // numSpheres
    u16(0), // numBoxes
    u32(0), // numFaces
    u32(0), // flags
    u32(4), // offsets (unused — all counts are 0)
    u32(4),
    u32(4),
    u32(4),
    u32(4),
  );

  return concat(fixedString('COL2', 4), u32(body.length), body);
}

describe('buildCollisionIndex / getCollision', () => {
  describe('negative cases', () => {
    it('builds an empty index when the archive has no .col entries', () => {
      const archive = archiveWith([{ data: u8(1, 2, 3), name: 'house.dff' }]);
      const index = buildCollisionIndex(archive);

      expect(index.size).toBe(0);
      expect(getCollision(index, 'house')).toBeNull();
    });

    it('returns null for a model with no collision', () => {
      const archive = archiveWith([{ data: colLibrary([{ modelId: 1, name: 'wall' }]), name: 'a.col' }]);
      const index = buildCollisionIndex(archive);

      expect(getCollision(index, 'missing')).toBeNull();
    });

    it('skips a .col entry that fails to parse', () => {
      const archive = archiveWith([
        { data: u8(255, 255, 255, 255, 0, 0, 0, 0), name: 'broken.col' },
        { data: colLibrary([{ modelId: 1, name: 'wall' }]), name: 'good.col' },
      ]);
      const index = buildCollisionIndex(archive);

      expect(index.size).toBe(1);
      expect(getCollision(index, 'wall')?.name).toBe('wall');
    });
  });

  describe('positive cases', () => {
    it('indexes models from every .col library by lowercased name', () => {
      const archive = archiveWith([
        { data: colLibrary([{ modelId: 10, name: 'Fence01' }]), name: 'one.col' },
        { data: colLibrary([{ modelId: 20, name: 'Gate02' }]), name: 'two.col' },
        { data: u8(9, 9, 9), name: 'ignored.txd' },
      ]);
      const index = buildCollisionIndex(archive);

      expect(index.size).toBe(2);
      expect(getCollision(index, 'fence01')?.modelId).toBe(10);
      expect(getCollision(index, 'GATE02')?.modelId).toBe(20); // lookup is case-insensitive
    });

    it('keeps the first occurrence when a name appears in multiple libraries', () => {
      const archive = archiveWith([
        { data: colLibrary([{ modelId: 1, name: 'dup' }]), name: 'first.col' },
        { data: colLibrary([{ modelId: 2, name: 'dup' }]), name: 'second.col' },
      ]);
      const index = buildCollisionIndex(archive);

      expect(getCollision(index, 'dup')?.modelId).toBe(1);
    });

    it('caches the index per archive (same instance on repeat calls)', () => {
      const archive = archiveWith([{ data: colLibrary([{ modelId: 1, name: 'wall' }]), name: 'a.col' }]);

      expect(buildCollisionIndex(archive)).toBe(buildCollisionIndex(archive));
    });
  });
});
