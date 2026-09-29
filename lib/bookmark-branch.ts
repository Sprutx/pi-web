/**
 * Fork: where a bookmark sits relative to the open branch. Client-safe: no
 * node imports, unlike lib/bookmarks.ts, which reads session files.
 */

/** The navigation tree as the session API sends it: kept nodes plus the chain ids folded into them. */
export interface BranchTreeNode {
  entry: { id: string };
  children: readonly BranchTreeNode[];
  compressedEntryIds?: readonly string[];
}

/**
 * Whether `entryId` lies on the branch that ends at `leafId`: the leaf itself
 * or one of its ancestors. The tree may be projected (single-child chains
 * folded into `compressedEntryIds` of the next kept node), so a leaf can sit
 * inside such a chain. Iterative: a linear session is thousands of levels deep.
 */
export function isEntryOnBranch(tree: readonly BranchTreeNode[], leafId: string | null, entryId: string): boolean {
  if (!leafId) return false;
  if (leafId === entryId) return true;
  const parent = new Map<BranchTreeNode, BranchTreeNode | null>();
  const stack: Array<[BranchTreeNode, BranchTreeNode | null]> = [];
  for (let i = tree.length - 1; i >= 0; i--) stack.push([tree[i], null]);
  let hit: BranchTreeNode | null = null;
  while (stack.length > 0) {
    const [node, up] = stack.pop()!;
    parent.set(node, up);
    if (node.entry.id === leafId || node.compressedEntryIds?.includes(leafId)) {
      hit = node;
      break;
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push([node.children[i], node]);
  }
  if (!hit) return false;
  const chain = hit.compressedEntryIds ?? [];
  const leafAt = hit.entry.id === leafId ? chain.length - 1 : chain.indexOf(leafId);
  if (chain.slice(0, leafAt + 1).includes(entryId)) return true;
  for (let node = parent.get(hit) ?? null; node; node = parent.get(node) ?? null) {
    if (node.entry.id === entryId || node.compressedEntryIds?.includes(entryId)) return true;
  }
  return false;
}
