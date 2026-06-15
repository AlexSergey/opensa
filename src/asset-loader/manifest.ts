/**
 * Manifest parsing + URL helpers (pure). The build writes `manifest.json` next to the chunk zips, so a
 * chunk's URL is the manifest's directory + the chunk file name.
 */
import type { ChunkInfo, GroupChunk, GroupName, Manifest } from './types';

/** The groups in load-priority order (priority first, then the heavy HD payload). */
export const GROUP_NAMES: readonly GroupName[] = ['priority', 'models', 'textures'];

/** Every chunk flattened across groups (priority → models → textures), each tagged with its group. */
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
  const { bytes, entries, file, hash } = value;
  if (
    typeof bytes !== 'number' ||
    typeof entries !== 'number' ||
    typeof file !== 'string' ||
    typeof hash !== 'string'
  ) {
    throw new Error(`manifest ${where} has invalid fields`);
  }

  return { bytes, entries, file, hash };
}
