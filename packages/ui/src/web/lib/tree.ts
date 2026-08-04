// 개요: 스팬 목록(parent_id 연결)을 호출 트리로 조립하는 유틸.
export interface SpanLike {
  id: string;
  parent_id: string | null;
  seq: number;
}

export type TreeNode<T extends SpanLike> = T & { children: TreeNode<T>[] };

/**
 * 개요: 스팬 배열을 호출 트리(루트 배열)로 바꾼다.
 * 로직: id→노드 맵을 만들고 seq순으로 부모에 붙인다. 부모가 없는(유실 포함) 스팬은 루트가 된다.
 */
export function buildTree<T extends SpanLike>(spans: T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const s of spans) nodes.set(s.id, { ...s, children: [] });
  const roots: TreeNode<T>[] = [];
  const sorted = [...nodes.values()].sort((a, b) => a.seq - b.seq);
  for (const node of sorted) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
