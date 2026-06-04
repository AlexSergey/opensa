import type { Group } from 'three';

import { FileLoader, Loader } from 'three';

import type { TextureDictionary } from './txd-loader';

import { parseDff } from '../parser/dff';
import { buildClump } from './build-clump';

/**
 * three.js Loader for RenderWare Clumps (.dff). Resolves to a THREE.Group.
 *
 * Call {@link DFFLoader.setTextures} before `load` (e.g. in `useLoader`'s
 * extensions callback) to apply a texture dictionary produced by TXDLoader.
 */
export class DFFLoader extends Loader<Group> {
  private textures?: TextureDictionary;

  override load(
    url: string,
    onLoad: (group: Group) => void,
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
          onLoad(buildClump(parseDff(buffer as ArrayBuffer), this.textures));
        } catch (error) {
          this.manager.itemError(url);
          onError?.(error);
        }
      },
      onProgress,
      onError,
    );
  }

  /** Inject textures to resolve material texture names against. */
  setTextures(textures: TextureDictionary): this {
    this.textures = textures;

    return this;
  }
}
