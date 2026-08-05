// 개요: 관계도에서 "이 메서드와 연결된 모든 것"을 계산하는 유틸.
// 로직: 호출 방향과 무관하게(호출한 쪽·불린 쪽 모두) 간선을 따라가며 전이적으로 모은다.
export interface EdgeLike {
  source: string;
  target: string;
}

/**
 * 개요: 시작 노드들에서 간선으로 이어진 노드 집합을 돌려준다(가까운 것부터, 상한 가능).
 * 로직: 너비 우선 탐색(BFS) — 상한에 걸리면 시작점에서 가까운 관계부터 남는다.
 * 참고: 검색 결과(여러 시작점)와 선택 강조(한 시작점) 둘 다 이걸 쓴다.
 *       전부 연결된 큰 프로젝트에서 "전이적 확장 = 사실상 전체"가 되는 것을 상한이 막아준다.
 */
export function reachableSet(
  startIds: string[],
  edges: EdgeLike[],
  maxNodes = Infinity,
): Set<string> {
  if (startIds.length === 0) return new Set();
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const seen = new Set<string>(startIds);
  const queue = [...startIds];
  let head = 0;
  while (head < queue.length && seen.size < maxNodes) {
    const current = queue[head++];
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        if (seen.size >= maxNodes) break;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
