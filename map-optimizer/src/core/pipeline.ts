import { mkdirSync } from 'node:fs';

import type { GameAdapter } from './adapter';
import type { Asset, MapPlugin, OptimizerConfig, PipelineContext } from './asset';
import type { MeshIR } from './ir';
import type { AssetFailure, AssetReport, RunReport } from './report';

const DEFAULT_CONCURRENCY = 4;

/**
 * Run the configured pipeline for one adapter: resolve → (read → plugins → write) per model → finalize.
 * `write` hands the optimized bytes to the adapter (which accumulates them); the adapter's `finalize` emits
 * all output. Per-asset errors are isolated and recorded — one bad model never aborts the run.
 */
export async function runPipeline(adapter: GameAdapter, config: OptimizerConfig, outDir: string): Promise<RunReport> {
  mkdirSync(outDir, { recursive: true });
  const refs = await adapter.resolve();
  const context = makeContext(adapter.game);
  const assets: AssetReport[] = [];
  const failures: AssetFailure[] = [];

  await runWithConcurrency(refs, config.concurrency ?? DEFAULT_CONCURRENCY, async (ref) => {
    try {
      const asset = await adapter.read(ref);
      const before = countGeometry(asset.ir);
      await applyPlugins(asset, config.plugins, context);
      const after = countGeometry(asset.ir);
      const { bytes } = await adapter.write(asset); // adapter accumulates; finalize emits the build
      assets.push({
        applied: asset.log.map((entry) => entry.plugin),
        bytesAfter: bytes.length,
        bytesBefore: asset.source.length,
        dirty: asset.dirty,
        name: asset.name,
        trianglesAfter: after.triangles,
        trianglesBefore: before.triangles,
        verticesAfter: after.vertices,
        verticesBefore: before.vertices,
      });
    } catch (error) {
      failures.push({ error: error instanceof Error ? error.message : String(error), name: ref.name });
    }
  });

  await adapter.finalize?.(outDir);

  return { assets, failures, game: adapter.game, outDir };
}

async function applyPlugins(asset: Asset, plugins: readonly MapPlugin[], context: PipelineContext): Promise<void> {
  for (const plugin of plugins) {
    if (plugin.accepts && !plugin.accepts(asset)) {
      continue;
    }
    await plugin.transform(asset, context);
  }
}

/** Total vertices + triangles across a model's sub-meshes (for before/after report stats). */
function countGeometry(ir: MeshIR): { triangles: number; vertices: number } {
  let vertices = 0;
  let triangles = 0;
  for (const mesh of ir.meshes) {
    vertices += mesh.positions.length / 3;
    triangles += mesh.triangles.length;
  }

  return { triangles, vertices };
}

function makeContext(game: string): PipelineContext {
  return {
    game,
    log: (asset, plugin, message): void => {
      asset.log.push({ message, plugin });
    },
  };
}

/** Run `worker` over `items` with at most `limit` in flight (mirrors the build script's helper). */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runner = async (): Promise<void> => {
    let item = queue.shift();
    while (item !== undefined) {
      await worker(item);
      item = queue.shift();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, runner));
}
