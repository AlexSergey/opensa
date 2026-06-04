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
  private convertToYUp = true;

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
          const clump = parseDff(buffer as ArrayBuffer);
          onLoad(buildClump(clump, this.textures, { convertToYUp: this.convertToYUp }));
        } catch (error) {
          this.manager.itemError(url);
          onError?.(error);
        }
      },
      onProgress,
      onError,
    );
  }

  /** Keep models in native Z-up space (for placing instances in GTA world space). */
  setConvertToYUp(convert: boolean): this {
    this.convertToYUp = convert;

    return this;
  }

  /** Inject textures to resolve material texture names against. */
  setTextures(textures: TextureDictionary): this {
    this.textures = textures;

    return this;
  }
}
