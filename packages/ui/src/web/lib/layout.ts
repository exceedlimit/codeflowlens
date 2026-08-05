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
export interface ColumnOpts {
  colWidth: number;
  rowHeight: number;
  /** 한 열의 최대 행 수 — 넘치면 옆 열로 감싼다(세로 한 줄 뭉개짐 방지) */
  maxRows?: number;
  colGap?: number;
}

/**
 * 개요: 깊이 그룹별 노드들의 화면 좌표를 만든다.
 * 로직: 깊이 순서대로 왼쪽→오른쪽. 한 깊이에 노드가 많으면 여러 열로 감싸고,
 *       다음 깊이는 그만큼 오른쪽에서 시작한다.
 */
export function columnPositions(
  groups: [number, string[]][],
  { colWidth, rowHeight, maxRows = 12, colGap = 48 }: ColumnOpts,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let xBase = 0;
  for (const [, ids] of [...groups].sort((a, b) => a[0] - b[0])) {
    const cols = Math.max(1, Math.ceil(ids.length / maxRows));
    ids.forEach((id, i) => {
      positions.set(id, {
        x: xBase + Math.floor(i / maxRows) * colWidth,
        y: (i % maxRows) * rowHeight,
      });
    });
    xBase += cols * colWidth + colGap;
  }
  return positions;
}

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
