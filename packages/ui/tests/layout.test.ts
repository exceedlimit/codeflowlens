// 개요: 관계도 자동 배치용 호출 깊이 계산 테스트.
import { describe, expect, it } from "vitest";

import { computeDepths } from "../src/web/lib/layout.js";

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
