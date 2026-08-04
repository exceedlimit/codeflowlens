// 개요: 관계도 자동 배치 — 호출 깊이(왼쪽=진입점, 오른쪽=말단)를 계산한다.
export interface EdgeLike {
  source: string;
  target: string;
}

/**
 * 개요: 각 노드의 호출 깊이를 계산한다(가장 긴 경로 기준).
 * 로직: 반복 완화 방식 — 엣지를 따라 target 깊이를 source+1로 끌어올리기를
 *       변화가 없을 때까지(최대 노드 수 회) 반복한다. 순환이 있어도 상한에서 멈춘다.
 */
export function computeDepths(
  nodeIds: string[],
  edges: EdgeLike[],
): Map<string, number> {
  const depth = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const cap = nodeIds.length;
  for (let round = 0; round < cap; round++) {
    let changed = false;
    for (const e of edges) {
      const ds = depth.get(e.source);
      const dt = depth.get(e.target);
      if (ds == null || dt == null) continue;
      if (ds + 1 > dt && ds + 1 <= cap) {
        depth.set(e.target, ds + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}
