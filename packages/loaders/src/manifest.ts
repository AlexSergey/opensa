/**
 * Manifest parsing + URL helpers (pure). The build writes `manifest.json` next to the chunk zips, so a
 * chunk's URL is the manifest's directory + the chunk file name.
 */
import type { ChunkInfo, GroupChunk, GroupName, Manifest } from './types';

/** The groups in load order (config/world/geometry first, then the heavy HD textures last). */
export const GROUP_NAMES: readonly GroupName[] = ['data', 'others', 'models', 'textures'];

/** Groups loaded in the first (core) phase — everything but the heavy textures. */
export const CORE_GROUPS: readonly GroupName[] = ['data', 'others', 'models'];

/** Every chunk flattened across groups (data → others → models → textures), each tagged with its group. */
export function allChunks(manifest: Manifest): GroupChunk[] {
  return GROUP_NAMES.flatMap((group) => manifest.chunks[group].map((chunk) => ({ ...chunk, group })));
}

/** A chunk's absolute URL: its directory + file name. */
export function chunkUrl(dir: string, info: ChunkInfo): string {
  return `${dir.replace(/\/+$/, '')}/${info.file}`;
}

/** Every chunk URL in the manifest (for invalidation diffing). */
export function chunkUrls(manifest: Manifest, dir: string): string[] {
  return allChunks(manifest).map((chunk) => chunkUrl(dir, chunk));
}

/** The directory a manifest URL lives in (everything up to the last `/`). */
export function manifestDir(manifestUrl: string): string {
  return manifestUrl.replace(/\/[^/]*$/, '');
}

/** Parse + validate raw manifest JSON, throwing a descriptive error on a malformed shape. */
export function parseManifest(json: unknown): Manifest {
  if (!isRecord(json)) {
    throw new Error('manifest is not an object');
  }
  const { chunks, game, version } = json;
  if (typeof game !== 'string' || typeof version !== 'string') {
    throw new Error('manifest is missing game/version');
  }
  if (!isRecord(chunks)) {
    throw new Error('manifest.chunks is missing');
  }
  const parsed = {} as Record<GroupName, ChunkInfo[]>;
  for (const group of GROUP_NAMES) {
    const list = chunks[group];
    if (!Array.isArray(list)) {
      throw new Error(`manifest.chunks.${group} is not an array`);
    }
    parsed[group] = list.map((chunk, index) => parseChunk(chunk, `chunks.${group}[${index}]`));
  }

  return { chunks: parsed, game, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseChunk(value: unknown, where: string): ChunkInfo {
  if (!isRecord(value)) {
    throw new Error(`manifest ${where} is not an object`);
  }
  const { bytes, cached, entries, file, hash } = value;
  if (
    typeof bytes !== 'number' ||
    typeof cached !== 'boolean' ||
    typeof entries !== 'number' ||
    typeof file !== 'string' ||
    typeof hash !== 'string'
  ) {
    throw new Error(`manifest ${where} has invalid fields`);
  }

  return { bytes, cached, entries, file, hash };
}
