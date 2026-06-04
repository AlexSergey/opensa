/**
 * Little-endian binary cursor over an ArrayBuffer.
 *
 * RenderWare streams are little-endian. This wraps a DataView with a moving
 * offset so the parsers read sequentially without manual offset arithmetic,
 * and is the single place where bounds are validated.
 */
export class BinaryStream {
  private readonly view: DataView;

  private cursor: number;

  readonly length: number;

  constructor(buffer: ArrayBuffer, byteOffset = 0, byteLength = buffer.byteLength - byteOffset) {
    this.view = new DataView(buffer, byteOffset, byteLength);
    this.length = byteLength;
    this.cursor = 0;
  }

  get position(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.length - this.cursor;
  }

  seek(offset: number): void {
    this.cursor = offset;
  }

  skip(bytes: number): void {
    this.cursor += bytes;
  }

  private require(bytes: number): void {
    if (this.cursor + bytes > this.length) {
      throw new RangeError(`BinaryStream out of bounds: need ${bytes} byte(s) at ${this.cursor}, length ${this.length}`);
    }
  }

  u8(): number {
    this.require(1);
    const value = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return value;
  }

  u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  i32(): number {
    this.require(4);
    const value = this.view.getInt32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  f32(): number {
    this.require(4);
    const value = this.view.getFloat32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  vec2(): [number, number] {
    return [this.f32(), this.f32()];
  }

  vec3(): [number, number, number] {
    return [this.f32(), this.f32(), this.f32()];
  }

  /** Read `length` raw bytes as a copy, advancing the cursor. */
  bytes(length: number): Uint8Array {
    this.require(length);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.cursor, length).slice();
    this.cursor += length;
    return out;
  }

  /** Read a fixed-length, NUL-terminated/padded ASCII string. */
  string(length: number): string {
    this.require(length);
    let result = '';
    for (let i = 0; i < length; i += 1) {
      const code = this.view.getUint8(this.cursor + i);
      if (code === 0) {
        break;
      }
      result += String.fromCharCode(code);
    }
    this.cursor += length;
    return result;
  }
}
