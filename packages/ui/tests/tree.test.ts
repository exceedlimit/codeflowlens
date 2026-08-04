// 개요: 스팬 목록 → 호출 트리 조립 유틸 테스트.
import { describe, expect, it } from "vitest";

import { buildTree, type SpanLike } from "../src/web/lib/tree.js";

function span(id: string, parent: string | null, seq: number): SpanLike {
  return { id, parent_id: parent, seq };
}

describe("buildTree", () => {
  it("parent_id 기반으로 트리를 만들고 seq순으로 정렬한다", () => {
    const roots = buildTree([
      span("b", "a", 1),
      span("a", null, 0),
      span("c", "a", 2),
      span("d", "b", 3),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("a");
    expect(roots[0].children.map((c) => c.id)).toEqual(["b", "c"]);
    expect(roots[0].children[0].children[0].id).toBe("d");
  });

  it("부모가 유실된 고아 스팬은 루트로 올린다", () => {
    const roots = buildTree([span("a", null, 0), span("x", "ghost", 1)]);
    expect(roots.map((r) => r.id)).toEqual(["a", "x"]);
  });

  it("빈 입력이면 빈 배열", () => {
    expect(buildTree([])).toEqual([]);
  });
});
