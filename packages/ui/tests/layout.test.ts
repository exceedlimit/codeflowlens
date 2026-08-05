// 개요: 관계도 자동 배치용 호출 깊이 계산 테스트.
import { describe, expect, it } from "vitest";

import { columnPositions, computeDepths } from "../src/web/lib/layout.js";

describe("computeDepths", () => {
  it("호출 체인의 깊이가 순서대로 커진다", () => {
    const d = computeDepths(["a", "b", "c"], [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ]);
    expect(d.get("a")).toBe(0);
    expect(d.get("b")).toBe(1);
    expect(d.get("c")).toBe(2);
  });

  it("다이아몬드 구조는 가장 긴 경로 기준", () => {
    const d = computeDepths(["a", "b", "c", "d"], [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ]);
    expect(d.get("d")).toBe(2);
  });

  it("순환이 있어도 끝나고 모든 노드에 깊이가 있다", () => {
    const d = computeDepths(["a", "b"], [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]);
    expect(d.size).toBe(2);
    expect(Number.isFinite(d.get("a"))).toBe(true);
  });

  it("고립 노드는 깊이 0", () => {
    const d = computeDepths(["x"], []);
    expect(d.get("x")).toBe(0);
  });
});

describe("columnPositions", () => {
  it("한 깊이가 maxRows를 넘으면 옆 열로 감싼다", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const pos = columnPositions([[0, ids]], { colWidth: 100, rowHeight: 10, maxRows: 12 });
    expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
    expect(pos.get("n11")).toEqual({ x: 0, y: 110 });
    expect(pos.get("n12")).toEqual({ x: 100, y: 0 }); // 두 번째 열
    expect(pos.get("n24")).toEqual({ x: 200, y: 0 }); // 세 번째 열
  });

  it("다음 깊이는 앞 깊이의 열 수만큼 오른쪽에서 시작한다", () => {
    const many = Array.from({ length: 24 }, (_, i) => `a${i}`);
    const pos = columnPositions(
      [[0, many], [1, ["b"]]],
      { colWidth: 100, rowHeight: 10, maxRows: 12, colGap: 50 },
    );
    expect(pos.get("b")).toEqual({ x: 250, y: 0 }); // 2열(200) + 간격(50)
  });
});
