// 개요: 관계도 연결 집합(도달 가능한 메서드 묶음) 계산 유틸 테스트.
import { describe, expect, it } from "vitest";

import { reachableSet } from "../src/web/lib/graphUtils.js";

const EDGES = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "x", target: "b" },
  { source: "p", target: "q" }, // 분리된 섬
];

describe("reachableSet", () => {
  it("호출 방향과 무관하게 연결된 모든 노드를 따라간다(전이적)", () => {
    // b에서 시작: 아래로 c, 위로 a·x까지 전부
    expect(reachableSet(["b"], EDGES)).toEqual(new Set(["a", "b", "c", "x"]));
  });

  it("끝 노드에서 시작해도 호출자 체인을 거슬러 올라간다", () => {
    expect(reachableSet(["c"], EDGES)).toEqual(new Set(["a", "b", "c", "x"]));
  });

  it("연결 안 된 섬은 포함하지 않는다", () => {
    expect(reachableSet(["a"], EDGES).has("p")).toBe(false);
  });

  it("여러 시작점(검색 결과)의 연결 집합을 합친다", () => {
    expect(reachableSet(["c", "q"], EDGES)).toEqual(
      new Set(["a", "b", "c", "x", "p", "q"]),
    );
  });

  it("고립 노드는 자기 자신만", () => {
    expect(reachableSet(["solo"], EDGES)).toEqual(new Set(["solo"]));
  });

  it("빈 시작점이면 빈 집합", () => {
    expect(reachableSet([], EDGES)).toEqual(new Set());
  });

  it("상한이 걸리면 가까운 관계부터 남는다(BFS)", () => {
    // 체인: s → 1 → 2 → 3 → 4
    const chain = [
      { source: "s", target: "1" },
      { source: "1", target: "2" },
      { source: "2", target: "3" },
      { source: "3", target: "4" },
    ];
    expect(reachableSet(["s"], chain, 3)).toEqual(new Set(["s", "1", "2"]));
  });
});
