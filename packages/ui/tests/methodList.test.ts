// 개요: 메서드 목록 헬퍼 테스트 — 검색 매칭(이름·파일·설명)과 인피니티 스크롤용 그룹 자르기.
import { describe, expect, it } from "vitest";

import { groupByFile, matchesQuery, sliceGroups } from "../src/web/lib/methodList.js";

const node = (id: string, doc: string | null = null) => ({
  id,
  file_path: id.split("::")[0],
  doc_overview: doc,
});

describe("matchesQuery", () => {
  it("이름·파일 경로(id)에 대소문자 무시로 매칭한다", () => {
    const n = node("app/Service.py::CreateOrder");
    expect(matchesQuery(n, "createorder")).toBe(true);
    expect(matchesQuery(n, "service")).toBe(true);
    expect(matchesQuery(n, "repo")).toBe(false);
  });

  it("설명(개요) 주석으로도 찾을 수 있다", () => {
    const n = node("app/service.py::create_order", "주문을 생성한다.");
    expect(matchesQuery(n, "주문")).toBe(true);
    expect(matchesQuery(node("app/service.py::x", null), "주문")).toBe(false);
  });

  it("빈 검색어는 전부 매칭", () => {
    expect(matchesQuery(node("a.py::f"), "")).toBe(true);
  });
});

describe("groupByFile", () => {
  it("파일 경로로 묶고 경로순 정렬한다", () => {
    const groups = groupByFile([node("b.py::f2"), node("a.py::f1"), node("b.py::f3")]);
    expect(groups.map(([f]) => f)).toEqual(["a.py", "b.py"]);
    expect(groups[1][1]).toHaveLength(2);
  });
});

describe("sliceGroups", () => {
  // 행 예산: 그룹 헤더 1행 + (펼쳐진 그룹이면) 항목당 1행
  const groups: [string, { id: string }[]][] = [
    ["a.py", [{ id: "a.py::f1" }, { id: "a.py::f2" }]],
    ["b.py", [{ id: "b.py::g1" }, { id: "b.py::g2" }, { id: "b.py::g3" }]],
    ["c.py", [{ id: "c.py::h1" }]],
  ];
  const allOpen = () => true;
  const allClosed = () => false;

  it("예산이 충분하면 전부 반환하고 hasMore=false", () => {
    const r = sliceGroups(groups, allOpen, 100);
    expect(r.groups).toHaveLength(3);
    expect(r.hasMore).toBe(false);
  });

  it("닫힌 그룹은 헤더 1행만 계산한다", () => {
    const r = sliceGroups(groups, allClosed, 2);
    expect(r.groups.map(([f]) => f)).toEqual(["a.py", "b.py"]);
    expect(r.hasMore).toBe(true);
  });

  it("펼쳐진 큰 그룹은 항목 단위로 잘라 부분만 반환한다", () => {
    // 예산 4 = a.py 헤더(1) + 항목 2 + b.py 헤더(1) → b.py 항목은 0개
    const r = sliceGroups(groups, allOpen, 4);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0][1]).toHaveLength(2);
    expect(r.groups[1][1]).toHaveLength(0);
    expect(r.hasMore).toBe(true);
  });

  it("그룹 중간에서 잘려도 다음 예산에서 이어진다", () => {
    const r = sliceGroups(groups, allOpen, 6); // a(1+2) + b(1+2/3)
    expect(r.groups[1][1]).toHaveLength(2);
    expect(r.hasMore).toBe(true);
  });

  it("빈 목록은 그대로", () => {
    const r = sliceGroups([], allOpen, 10);
    expect(r.groups).toEqual([]);
    expect(r.hasMore).toBe(false);
  });
});
