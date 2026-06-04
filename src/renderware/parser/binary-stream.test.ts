import { describe, expect, it } from 'vitest';

import { concat, f32, fixedString, i32, toArrayBuffer, u8, u16, u32 } from '../test-utils';
import { BinaryStream } from './binary-stream';

describe('BinaryStream', () => {
  it('reads little-endian integers and advances the cursor', () => {
    const stream = new BinaryStream(toArrayBuffer(concat(u8(0xab), u16(0x1234), u32(0xdeadbeef))));
    expect(stream.u8()).toBe(0xab);
    expect(stream.position).toBe(1);
    expect(stream.u16()).toBe(0x1234);
    expect(stream.position).toBe(3);
    expect(stream.u32()).toBe(0xdeadbeef);
    expect(stream.position).toBe(7);
    expect(stream.remaining).toBe(0);
  });

  it('reads signed 32-bit and 32-bit floats', () => {
    const stream = new BinaryStream(toArrayBuffer(concat(i32(-5), f32(1.5))));
    expect(stream.i32()).toBe(-5);
    expect(stream.f32()).toBeCloseTo(1.5, 6);
  });

  it('reads vec2 and vec3 tuples', () => {
    const stream = new BinaryStream(toArrayBuffer(concat(f32(1), f32(2), f32(3), f32(4), f32(5))));
    expect(stream.vec2()).toEqual([1, 2]);
    expect(stream.vec3()).toEqual([3, 4, 5]);
  });

  it('trims fixed-length strings at the first NUL', () => {
    const stream = new BinaryStream(toArrayBuffer(fixedString('cedar', 16)));
    expect(stream.string(16)).toBe('cedar');
    expect(stream.position).toBe(16);
  });

  it('copies raw bytes without aliasing the source buffer', () => {
    const source = concat(u8(1, 2, 3, 4));
    const stream = new BinaryStream(toArrayBuffer(source));
    const copy = stream.bytes(4);
    copy[0] = 99;
    expect(Array.from(copy)).toEqual([99, 2, 3, 4]);
    expect(stream.position).toBe(4);
  });

  it('seek and skip move the cursor', () => {
    const stream = new BinaryStream(toArrayBuffer(u32(0x11223344)));
    stream.skip(2);
    expect(stream.position).toBe(2);
    stream.seek(0);
    expect(stream.u16()).toBe(0x3344);
  });

  it('honours byteOffset/byteLength windows', () => {
    const full = toArrayBuffer(concat(u32(0), u16(0x7777)));
    const stream = new BinaryStream(full, 4, 2);
    expect(stream.length).toBe(2);
    expect(stream.u16()).toBe(0x7777);
  });

  it('throws when reading past the end', () => {
    const stream = new BinaryStream(toArrayBuffer(u8(1, 2)));
    stream.u16();
    expect(() => stream.u8()).toThrow(RangeError);
  });
});
