import { looseGroup } from '@opensa/game-build/partition';

/**
 * The local asset loader (plan 053): reads a user-picked **raw GTA San Andreas install** folder via the File
 * System Access API and converts it in-browser to the same in-memory VFS the fetch loader produces — so the
 * downstream flow is identical. The picked folder handle is remembered (IndexedDB) and not re-prompted unless
 * it becomes invalid. Chromium-only; opt-in via `VITE_ASSET_LOADER=local`.
 *
 * `prepare()` does the one user-gesture step (the folder prompt) and is called from the Play click; `init()`
 * scans + selects the asset set (same buckets as `scripts/build-game.ts`) and returns a synthesised manifest;
 * `load(groups)` reads the selected bytes straight into the VFS, emitting count-based progress.
 */
import type { AssetLoader, AssetLoaderEvents, ChunkInfo, GroupName, Manifest } from '../types';
import type { InstallPlan, InstallSource } from './build-vfs';
import type { RestoredDir } from './dir-handle-store';

import { Emitter } from '../emitter';
import { GROUP_NAMES } from '../manifest';
import { readEntry, selectInstallEntries } from './build-vfs';
import { browserDirHandleDeps, pickDir, restoreDir } from './dir-handle-store';
import { browserInstallSource } from './install-source';

export interface AssetLocalLoaderConfig {
  /** The build variant + version, used to label the synthesised manifest. */
  game: string;
  /** TEMPORARY: ped models (from `peds.ide`) to pull into the selection — e.g. `[VITE_MAIN_CHARACTER]`. */
  peds?: readonly string[];
  /** Where resolved file bytes go — the VFS. Optional so the loader runs/tests standalone. */
  sink?: { addFiles(chunkId: string, entries: Iterable<readonly [string, Uint8Array]>): Promise<void> | void };
  /** TEMPORARY: vehicle models (from `vehicles.ide`) to also pull into the selection. */
  vehicles?: readonly string[];
  version: string;
}

/** Seams for testing without the File System Access API; default to the real browser wiring. */
export interface AssetLocalLoaderDeps {
  /** Resolve a usable directory, prompting if needed (USER GESTURE) — given the boot-restored handle. */
  acquireDir: (stored: FileSystemDirectoryHandle | null) => Promise<FileSystemDirectoryHandle>;
  /** Open an {@link InstallSource} over a directory handle. */
  openSource: (dir: FileSystemDirectoryHandle) => Promise<InstallSource>;
  /** Boot-time (no gesture): load the remembered handle + whether it is already usable. */
  restoreDir: () => Promise<RestoredDir>;
}

/** One file to materialise into the VFS — its VFS key + how to read its bytes from the install. */
interface FileTask {
  name: string;
  read: (source: InstallSource) => Promise<Uint8Array>;
}

export class AssetLocalLoader implements AssetLoader {
  readonly events = new Emitter<AssetLoaderEvents>();

  private readonly deps: AssetLocalLoaderDeps;
  private dir: FileSystemDirectoryHandle | null = null;
  private plan: InstallPlan | null = null;
  private source: InstallSource | null = null;
  private stored: FileSystemDirectoryHandle | null = null;

  constructor(
    private readonly config: AssetLocalLoaderConfig,
    deps?: Partial<AssetLocalLoaderDeps>,
  ) {
    this.deps = {
      acquireDir:
        deps?.acquireDir ?? ((stored): Promise<FileSystemDirectoryHandle> => pickDir(browserDirHandleDeps(), stored)),
      openSource: deps?.openSource ?? browserInstallSource,
      restoreDir: deps?.restoreDir ?? ((): Promise<RestoredDir> => restoreDir(browserDirHandleDeps())),
    };
  }

  async init(): Promise<Manifest> {
    const { plan } = await this.ensure();

    return synthManifest(this.config, plan);
  }

  async load(groups: readonly GroupName[] = GROUP_NAMES): Promise<void> {
    const { plan, source } = await this.ensure();
    const work = groups.map((group) => ({ files: filesForGroup(plan, group), group }));
    const total = work.reduce((sum, item) => sum + item.files.length, 0);

    let done = 0;
    let completedGroups = 0;
    const emit = (): void =>
      this.events.emit('progress', {
        loadedBytes: done,
        loadedChunks: completedGroups,
        totalBytes: total,
        totalChunks: work.length,
      });
    emit();

    for (const { files, group } of work) {
      const entries: [string, Uint8Array][] = [];
      for (const file of files) {
        entries.push([file.name, await file.read(source)]);
        done += 1;
        emit();
      }
      await this.config.sink?.addFiles(`local-${group}`, entries);
      completedGroups += 1;
    }
  }

  /**
   * The gesture-bound folder step — called from the Play click. Uses the boot-restored handle (so the picker /
   * permission request is the first await and keeps the user activation). A denied/cancelled prompt rejects;
   * the stored handle is forgotten so the next click prompts afresh.
   */
  async prepare(): Promise<void> {
    if (this.dir) {
      return;
    }
    try {
      this.dir = await this.deps.acquireDir(this.stored);
    } catch (error) {
      this.stored = null;
      throw error;
    }
  }

  /** `true` once a folder has been acquired (via {@link prepare} or an already-granted {@link restore}). */
  ready(): boolean {
    return this.dir !== null;
  }

  /** Boot-time (no gesture): restore the remembered folder so {@link prepare} can skip / shorten the prompt. */
  async restore(): Promise<void> {
    const { handle, ready } = await this.deps.restoreDir();
    this.stored = handle;
    if (ready && handle) {
      this.dir = handle;
    }
  }

  /** Resolve the install source + selection once (memoised). Requires {@link prepare}/{@link restore} first. */
  private async ensure(): Promise<{ plan: InstallPlan; source: InstallSource }> {
    if (!this.dir) {
      throw new Error('install folder not selected — call prepare() from a user gesture first');
    }
    this.source ??= await this.deps.openSource(this.dir);
    this.plan ??= await selectInstallEntries(this.source, { peds: this.config.peds, vehicles: this.config.vehicles });

    return { plan: this.plan, source: this.source };
  }
}

/** A task reading an archive entry's bytes (model/texture/world). */
function entryTask(entry: InstallPlan['models'][number]): FileTask {
  return { name: entry.name, read: (source) => readEntry(source, entry) };
}

/** The files to ingest for one group: the loose files bucketed into it + its img archive entries. */
function filesForGroup(plan: InstallPlan, group: GroupName): FileTask[] {
  const loose = plan.loose
    .filter((path) => looseGroup(path) === group)
    .map((path): FileTask => ({ name: path, read: (source) => source.readLoose(path) }));
  if (group === 'models') {
    return [...loose, ...plan.models.map(entryTask)];
  }
  if (group === 'textures') {
    return [...loose, ...plan.textures.map(entryTask)];
  }
  if (group === 'others') {
    return [...loose, ...plan.others.map(entryTask)];
  }

  return loose; // data — loose files under data/ only
}

/** A manifest mirroring the selection (one synthetic chunk per group) so `Vfs.verify` matches the ingest. */
function synthManifest(config: AssetLocalLoaderConfig, plan: InstallPlan): Manifest {
  const chunk = (group: GroupName, count: number): ChunkInfo => ({
    bytes: count,
    cached: false, // the local loader reads from disk every boot — nothing goes through Cache Storage
    entries: count,
    file: `local-${group}`,
    hash: '',
  });
  const groupCount = (group: GroupName): number => filesForGroup(plan, group).length;

  return {
    chunks: {
      data: [chunk('data', groupCount('data'))],
      models: [chunk('models', groupCount('models'))],
      others: [chunk('others', groupCount('others'))],
      textures: [chunk('textures', groupCount('textures'))],
    },
    game: config.game,
    version: config.version,
  };
}
