/**
 * Visualise the project architecture as a Mermaid flowchart, derived from the **actual** workspace packages and
 * their `@opensa/*` (plus three.js / Rapier) imports — so the picture can't drift from the code.
 *
 *   tsx scripts/arch-graph.ts                 # print the Mermaid graph to stdout
 *   tsx scripts/arch-graph.ts --out docs/architecture.generated.md
 *   tsx scripts/arch-graph.ts --no-externals  # internal packages only (drop three.js / Rapier)
 *   tsx scripts/arch-graph.ts --include-tests  # also follow imports in *.test.ts
 *
 * Paste the output into a ```mermaid block (GitHub renders it) or https://mermaid.live.
 */
import { type Dirent, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

type Layer = 'app' | 'engine' | 'tool';

interface Pkg {
  /** Mermaid-safe node id (e.g. `lod_generator`). */
  id: string;
  label: string;
  layer: Layer;
  name: string;
  srcDir: string;
}

function layerOf(dir: string): Layer {
  if (dir.startsWith('apps/')) {
    return 'app';
  }

  return dir.startsWith('tools/') ? 'tool' : 'engine';
}

function loadPackages(): Map<string, Pkg> {
  const byName = new Map<string, Pkg>();
  for (const dir of workspaceDirs()) {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as {
      description?: string;
      name: string;
    };
    const desc = shortDesc(manifest.description ?? '');
    byName.set(manifest.name, {
      id: manifest.name.replace('@opensa/', '').replace(/[^a-z0-9]/gi, '_'),
      label: desc ? `${manifest.name.replace('@opensa/', '')} · ${desc}` : manifest.name.replace('@opensa/', ''),
      layer: layerOf(dir),
      name: manifest.name,
      srcDir: join(ROOT, dir, 'src'),
    });
  }

  return byName;
}

/** A short, diagram-friendly label from the package.json description (the bit that lists what it does). */
function shortDesc(description: string): string {
  const afterColon = description.includes(':') ? description.slice(description.indexOf(':') + 1) : description;
  const clause = afterColon
    .split(/[(;.]|\s—\s/)[0]
    .trim()
    .replace(/\s+/g, ' ');

  return clause.length > 56 ? `${clause.slice(0, 53)}…` : clause;
}

/** Workspace globs are flat (`packages/x`, not `packages/*`), so each entry is a concrete dir. */
function workspaceDirs(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { workspaces?: string[] };

  return (pkg.workspaces ?? []).filter((w) => !w.includes('*'));
}

const SKIP_DIRS = new Set(['.nx', 'build', 'coverage', 'dist', 'node_modules', 'out']);
/** Quoted module specifiers we map to a graph node: `@opensa/*`, `three[/…]`, `@dimforge/rapier3d…`. */
const TARGET_RE = /['"](@opensa\/[^'"]+|@dimforge\/rapier3d[^'"]*|three(?:\/[^'"]*)?)['"]/g;

/** Every interesting module specifier imported under a package's `src/` (optionally including test files). */
function importsOf(srcDir: string, includeTests: boolean): Set<string> {
  const specifiers = new Set<string>();
  for (const file of walkFiles(srcDir)) {
    if (!/\.tsx?$/.test(file) || (!includeTests && /\.(?:test|spec)\.tsx?$/.test(file))) {
      continue;
    }
    for (const match of readFileSync(file, 'utf8').matchAll(TARGET_RE)) {
      specifiers.add(match[1]);
    }
  }

  return specifiers;
}

/** Map a module specifier to the node it depends on: an internal package, an external lib, or null. */
function resolveTarget(specifier: string, packages: Map<string, Pkg>, externals: boolean): null | string {
  const opensa = /^(@opensa\/[^/]+)/.exec(specifier)?.[1];
  if (opensa) {
    return packages.has(opensa) ? packages.get(opensa)!.id : null;
  }
  if (!externals) {
    return null;
  }
  if (specifier === 'three' || specifier.startsWith('three/')) {
    return 'ext_three';
  }

  return specifier.startsWith('@dimforge/rapier3d') ? 'ext_rapier' : null;
}

/** Recursively list every file under `dir` (skipping build/dep folders); [] when the folder is absent. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }

  return out;
}

const COLORS: Record<string, string> = {
  app: 'fill:#FFE0B2,stroke:#E65100,color:#000',
  engine: 'fill:#BBDEFB,stroke:#1565C0,color:#000',
  external: 'fill:#ECEFF1,stroke:#607D8B,color:#000',
  tool: 'fill:#C8E6C9,stroke:#2E7D32,color:#000',
};

function buildMermaid(packages: Map<string, Pkg>, externals: boolean, includeTests: boolean): string {
  const pkgs = [...packages.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
  const edges = new Set<string>();
  const usedExternals = new Set<string>();
  for (const pkg of pkgs) {
    for (const specifier of importsOf(pkg.srcDir, includeTests)) {
      const target = resolveTarget(specifier, packages, externals);
      if (target && target !== pkg.id) {
        edges.add(`${pkg.id} --> ${target}`);
        if (target.startsWith('ext_')) {
          usedExternals.add(target);
        }
      }
    }
  }

  const lines = ['flowchart TD', '  %% generated by scripts/arch-graph.ts — do not edit by hand'];
  for (const pkg of pkgs) {
    lines.push(`  ${pkg.id}["${pkg.label}"]`);
  }
  if (usedExternals.has('ext_three')) {
    lines.push('  ext_three["three.js — WebGL renderer"]');
  }
  if (usedExternals.has('ext_rapier')) {
    lines.push('  ext_rapier["Rapier — physics"]');
  }
  lines.push('');
  for (const edge of [...edges].sort()) {
    lines.push(`  ${edge}`);
  }
  lines.push('');
  for (const [name, style] of Object.entries(COLORS)) {
    lines.push(`  classDef ${name} ${style};`);
  }
  for (const layer of ['app', 'engine', 'tool'] as const) {
    const ids = pkgs.filter((p) => p.layer === layer).map((p) => p.id);
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(',')} ${layer};`);
    }
  }
  if (usedExternals.size > 0) {
    lines.push(`  class ${[...usedExternals].sort().join(',')} external;`);
  }

  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const externals = !args.includes('--no-externals');
  const includeTests = args.includes('--include-tests');
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : null;

  const graph = buildMermaid(loadPackages(), externals, includeTests);
  if (!out) {
    process.stdout.write(`${graph}\n`);

    return;
  }
  const body = out.endsWith('.md') ? `# Architecture\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n` : `${graph}\n`;
  writeFileSync(join(ROOT, out), body, 'utf8');
  process.stdout.write(`wrote ${out}\n`);
}

main();
