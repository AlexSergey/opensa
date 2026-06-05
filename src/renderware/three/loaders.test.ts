import type { MeshStandardMaterial } from 'three';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileLoader, Group, Mesh } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RwSection } from '../parsers/binary/constants';
import { chunk, toArrayBuffer, u32 } from '../test-utils';
import { DFFLoader } from './dff-loader';
import { TXDLoader } from './txd-loader';

/** Make FileLoader.load synchronously deliver `buffer` (or fail) without I/O. */
function stubFileLoader(buffer: ArrayBuffer | null): void {
  vi.spyOn(FileLoader.prototype, 'load').mockImplementation(function mockLoad(
    this: FileLoader,
    _url: string,
    onLoad?: (data: ArrayBuffer | string) => void,
    _onProgress?: unknown,
    onError?: (error: unknown) => void,
  ) {
    if (buffer) {
      onLoad?.(buffer);
    } else {
      onError?.(new Error('network'));
    }

    return;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const dffPath = join(process.cwd(), 'tests', 'renderware', 'testground.dff');
const txdPath = join(process.cwd(), 'tests', 'renderware', 'testground.txd');
const assetsExist = existsSync(dffPath) && existsSync(txdPath);

function assetBuffer(path: string): ArrayBuffer {
  return toArrayBuffer(new Uint8Array(readFileSync(path)));
}

function firstMaterial(group: Group): MeshStandardMaterial {
  const mesh = group.children[0] as Mesh;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

  return material as MeshStandardMaterial;
}

describe('TXDLoader', () => {
  it.skipIf(!assetsExist)('resolves a name-keyed texture map', () => {
    stubFileLoader(assetBuffer(txdPath));
    const onLoad = vi.fn();
    new TXDLoader().load('testground.txd', onLoad);
    const map = onLoad.mock.calls[0][0] as Map<string, unknown>;
    expect(map.size).toBe(2);
    expect(map.has('sam_camo')).toBe(true);
  });

  it('forwards parse failures to onError', () => {
    stubFileLoader(toArrayBuffer(chunk(RwSection.CLUMP, u32(0)))); // wrong type for a TXD
    const onError = vi.fn();
    new TXDLoader().load('bad.txd', vi.fn(), undefined, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/Not a TXD/);
  });
});

describe('DFFLoader', () => {
  it.skipIf(!assetsExist)('resolves a Group built from the clump', () => {
    stubFileLoader(assetBuffer(dffPath));
    const onLoad = vi.fn();
    new DFFLoader().load('model.dff', onLoad);
    const group = onLoad.mock.calls[0][0] as Group;
    expect(group).toBeInstanceOf(Group);
    expect(group.children[0]).toBeInstanceOf(Mesh);
  });

  it.skipIf(!assetsExist)('applies textures injected via setTextures', () => {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const textures = (() => {
      stubFileLoader(assetBuffer(txdPath));
      const onLoad = vi.fn();
      new TXDLoader().load('testground.txd', onLoad);

      return onLoad.mock.calls[0][0] as Parameters<DFFLoader['setTextures']>[0];
    })();

    stubFileLoader(assetBuffer(dffPath));
    const onLoad = vi.fn();
    new DFFLoader().setTextures(textures).load('model.dff', onLoad);
    const material = firstMaterial(onLoad.mock.calls[0][0] as Group);
    expect(material.map?.name).toBe('sam_camo');
  });

  it.skipIf(!assetsExist)('leaves materials untextured when no dictionary is set', () => {
    stubFileLoader(assetBuffer(dffPath));
    const onLoad = vi.fn();
    new DFFLoader().load('model.dff', onLoad);
    expect(firstMaterial(onLoad.mock.calls[0][0] as Group).map).toBeNull();
  });

  it('forwards parse failures to onError', () => {
    stubFileLoader(toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, u32(0)))); // wrong type for a DFF
    const onError = vi.fn();
    new DFFLoader().load('bad.dff', vi.fn(), undefined, onError);
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/Not a DFF/);
  });
});
