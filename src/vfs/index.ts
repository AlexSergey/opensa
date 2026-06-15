/** Virtual File System (plan 050): unzips the loader's chunks and serves them behind `AssetFileSystem`. */
export type { AssetFileSystem } from '../renderware/archive';
export { manifestTotals, verifyTotals, type VfsTotals } from './verify';
export { Vfs } from './vfs';
