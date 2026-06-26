import type { HdTree, TreeLodAdapter, TreeLodConfig } from './types';

import { renderImpostor } from './render';

/**
 * Generic driver: enumerate the input HD trees, bake each impostor (render → card atlas), and hand them to the
 * adapter to encode + write (LOD DFFs + shared atlas TXD + COL) into `--out`.
 */
export function run(adapter: TreeLodAdapter, config: TreeLodConfig): void {
  const inputs = adapter.listInputs();
  console.log(`lod-trees-generator: ${inputs.length} HD tree(s) · ${config.cards} cards · ${config.textureSize}px`);

  const impostors = inputs.map((input) => {
    const tree = adapter.loadTree(input);
    console.log(`  ${tree.name}: ${tree.triangles.length} tris · bbox ${bboxSize(tree)}`);

    return renderImpostor(tree, config);
  });

  adapter.finalize(impostors);
}

function bboxSize(tree: HdTree): string {
  const { max, min } = tree.bbox;

  return max.map((value, axis) => (value - min[axis]).toFixed(1)).join('×');
}
