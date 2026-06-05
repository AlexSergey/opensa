import type { Texture } from 'three';

import { FileLoader, Loader } from 'three';

import { parseTxd } from '../parsers/binary/txd';
import { buildTextureMap } from './build-texture';

export type TextureDictionary = Map<string, Texture>;

/**
 * three.js Loader for RenderWare Texture Dictionaries (.txd).
 * Resolves to a Map of lowercased texture name -> THREE.Texture, suitable for
 * injecting into {@link DFFLoader} via `useLoader`'s extensions callback.
 */
export class TXDLoader extends Loader<TextureDictionary> {
  override load(
    url: string,
    onLoad: (textures: TextureDictionary) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const fileLoader = new FileLoader(this.manager);
    fileLoader.setResponseType('arraybuffer');
    fileLoader.setPath(this.path);
    fileLoader.load(
      url,
      (buffer) => {
        try {
          onLoad(buildTextureMap(parseTxd(buffer as ArrayBuffer)));
        } catch (error) {
          this.manager.itemError(url);
          onError?.(error);
        }
      },
      onProgress,
      onError,
    );
  }
}
