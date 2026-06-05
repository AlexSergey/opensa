/**
 * Binary builders for constructing synthetic RenderWare streams in tests.
 * Everything is little-endian to match {@link BinaryStream}.
 */

/** Wrap a payload in a 12-byte RenderWare chunk header. */
export function chunk(type: number, payload: Uint8Array, version = 0x1803ffff): Uint8Array {
  return concat(u32(type), u32(payload.length), u32(version), payload);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

export function f32(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setFloat32(0, value, true);

  return buffer;
}

export function f32a(values: number[]): Uint8Array {
  return concat(...values.map(f32));
}

/** Fixed-length, NUL-padded ASCII string. */
export function fixedString(text: string, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  for (let i = 0; i < text.length && i < length; i += 1) {
    buffer[i] = text.charCodeAt(i);
  }

  return buffer;
}

export function i16(value: number): Uint8Array {
  const buffer = new Uint8Array(2);
  new DataView(buffer.buffer).setInt16(0, value, true);

  return buffer;
}

export function i32(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setInt32(0, value, true);

  return buffer;
}

/** Detach a tightly-sized ArrayBuffer from a Uint8Array view. */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function u8(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

export function u16(value: number): Uint8Array {
  const buffer = new Uint8Array(2);
  new DataView(buffer.buffer).setUint16(0, value, true);

  return buffer;
}

export function u32(value: number): Uint8Array {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setUint32(0, value >>> 0, true);

  return buffer;
}
