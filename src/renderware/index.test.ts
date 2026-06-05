import { describe, expect, it } from 'vitest';

import * as renderware from './index';

// Guards the public barrel — `export *` re-exports must actually be reachable.
describe('renderware barrel', () => {
  it('re-exports the parser/map/archive public API', () => {
    expect(typeof renderware.parseColLibrary).toBe('function');
    expect(typeof renderware.parseDff).toBe('function');
    expect(typeof renderware.parseTxd).toBe('function');
    expect(typeof renderware.parseGtaDat).toBe('function');
    expect(typeof renderware.parseBinaryIpl).toBe('function');
    expect(typeof renderware.isLodModel).toBe('function');
    expect(typeof renderware.resolveMap).toBe('function');
    expect(typeof renderware.buildWorldGrid).toBe('function');
    expect(typeof renderware.buildCell).toBe('function');
    expect(typeof renderware.getClump).toBe('function');
    expect(typeof renderware.getTextures).toBe('function');
    expect(typeof renderware.modelKey).toBe('function');
    expect(typeof renderware.openArchive).toBe('function');
    expect(typeof renderware.buildClumpParts).toBe('function');
    expect(typeof renderware.buildCollisionIndex).toBe('function');
    expect(typeof renderware.getCollision).toBe('function');
    expect(typeof renderware.buildColliders).toBe('function');
    expect(typeof renderware.buildCellColliders).toBe('function');
    expect(typeof renderware.buildCollisionWireframe).toBe('function');
  });
});
