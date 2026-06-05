import { describe, expect, it } from 'vitest';

import { chunk, concat, fixedString, toArrayBuffer, u32 } from '../../test-utils';
import { BinaryStream } from './binary-stream';
import { findChild, forEachChild, readChunkHeader, readStringChunk } from './chunks';
import { RwSection } from './constants';

function streamOf(view: Uint8Array): BinaryStream {
  return new BinaryStream(toArrayBuffer(view));
}

describe('readChunkHeader', () => {
  it('parses type, size, version and payload bounds', () => {
    const stream = streamOf(chunk(RwSection.CLUMP, u32(0), 0x1803ffff));
    const header = readChunkHeader(stream);
    expect(header.type).toBe(RwSection.CLUMP);
    expect(header.size).toBe(4);
    expect(header.version).toBe(0x1803ffff);
    expect(header.dataStart).toBe(12);
    expect(header.end).toBe(16);
  });
});

describe('forEachChild / findChild', () => {
  const container = concat(
    chunk(RwSection.STRUCT, u32(1)),
    chunk(RwSection.STRING, fixedString('hello', 8)),
    chunk(RwSection.EXTENSION, u32(0)),
  );

  it('iterates each direct child once, in order', () => {
    const stream = streamOf(container);
    const types: number[] = [];
    forEachChild(stream, 0, container.length, (header) => types.push(header.type));
    expect(types).toEqual([RwSection.STRUCT, RwSection.STRING, RwSection.EXTENSION]);
  });

  it('advances past a child even if the callback consumes nothing', () => {
    const stream = streamOf(container);
    let count = 0;
    forEachChild(stream, 0, container.length, () => {
      count += 1;
    });
    expect(count).toBe(3);
  });

  it('findChild returns the first matching child or null', () => {
    const stream = streamOf(container);
    expect(findChild(stream, 0, container.length, RwSection.STRING)?.type).toBe(RwSection.STRING);
    expect(findChild(stream, 0, container.length, RwSection.MATERIAL)).toBeNull();
  });

  it('does not descend into nested chunks', () => {
    const nested = chunk(RwSection.EXTENSION, chunk(RwSection.STRING, fixedString('inner', 8)));
    const stream = streamOf(nested);
    const top: number[] = [];
    forEachChild(stream, 0, nested.length, (header) => top.push(header.type));
    expect(top).toEqual([RwSection.EXTENSION]);
  });
});

describe('readStringChunk', () => {
  it('reads NUL-terminated text from a String chunk', () => {
    const view = chunk(RwSection.STRING, fixedString('tree_branches44', 16));
    const stream = streamOf(view);
    const header = readChunkHeader(stream);
    expect(readStringChunk(stream, header)).toBe('tree_branches44');
  });
});
