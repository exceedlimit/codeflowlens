// 개요: 메서드 목록 화면용 순수 헬퍼 — 검색 매칭과 인피니티 스크롤용 그룹 자르기.
// 로직: 검색은 id(파일 경로+이름)뿐 아니라 설명(개요) 주석까지 본다.
//       sliceGroups는 "행 예산"만큼만 잘라 돌려줘서 수천 개 목록도 조금씩 그린다.

export interface SearchableNode {
  id: string;
  doc_overview: string | null;
}

/** 개요: 검색어가 id(파일·이름) 또는 설명(개요)에 들어 있는지 — 대소문자 무시. */
export function matchesQuery(node: SearchableNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.id.toLowerCase().includes(q)) return true;
  return node.doc_overview != null && node.doc_overview.toLowerCase().includes(q);
}

/** 개요: 노드를 파일별로 묶어 경로순으로 돌려준다. */
export function groupByFile<T extends { file_path: string }>(nodes: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const n of nodes) {
    if (!groups.has(n.file_path)) groups.set(n.file_path, []);
    groups.get(n.file_path)!.push(n);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * 개요: 그룹 목록을 화면 행 예산만큼 잘라낸다 — 스크롤할수록 예산을 늘려 이어 그린다.
 * 로직: 그룹 헤더 1행 + 펼쳐진 그룹의 항목당 1행. 예산이 그룹 중간에서 끝나면
 *       그 그룹의 항목을 부분만 담는다. 남은 게 있으면 hasMore=true.
 */
export function sliceGroups<T>(
  groups: [string, T[]][],
  isOpen: (file: string) => boolean,
  budget: number,
): { groups: [string, T[]][]; hasMore: boolean } {
  const out: [string, T[]][] = [];
  let left = budget;
  for (let i = 0; i < groups.length; i++) {
    if (left <= 0) return { groups: out, hasMore: true };
    const [file, items] = groups[i];
    left -= 1; // 그룹 헤더
    if (!isOpen(file)) {
      out.push([file, items]);
      continue;
    }
    const take = Math.max(0, Math.min(items.length, left));
    left -= take;
    out.push([file, items.slice(0, take)]);
    if (take < items.length) return { groups: out, hasMore: true };
  }
  return { groups: out, hasMore: false };
}
