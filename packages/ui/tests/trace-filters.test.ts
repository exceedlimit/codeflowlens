// 개요: 트레이스 목록 필터(기간/진입점/서비스)와 진입점 추적 제외 API 테스트.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

const NOW = Date.now() / 1000;
let server: Awaited<ReturnType<typeof buildServer>>;
let dbPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowlens-tf-"));
  dbPath = join(dir, "data.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO settings VALUES ('retention_days', '365')").run();
  const ins = db.prepare(
    `INSERT INTO traces (id, started_at, ended_at, status, entry_kind, entry_name, service)
     VALUES (?, ?, ?, 'ok', 'http', ?, ?)`,
  );
  ins.run("t-old", NOW - 3 * 3600, NOW - 3 * 3600 + 1, "GET /orders", "python");
  ins.run("t-new1", NOW - 60, NOW - 59, "GET /orders", "python");
  ins.run("t-new2", NOW - 30, NOW - 29, "POST /orders", "node");
  ins.run("t-new3", NOW - 10, NOW - 9, "GET /health", "node");
  db.close();
  server = await buildServer({ dbPath });
});

afterAll(async () => server.close());

describe("GET /api/traces 필터", () => {
  it("기간(since) 필터가 적용되고 total·facets가 온다", async () => {
    const res = await server.inject({ url: `/api/traces?since=${NOW - 3600}` });
    const body = res.json();
    expect(body.traces.map((t: any) => t.id).sort()).toEqual(["t-new1", "t-new2", "t-new3"]);
    expect(body.total).toBe(3);
    expect(body.facets.entries).toContain("GET /orders");
    expect(body.facets.services).toEqual(expect.arrayContaining(["python", "node"]));
  });

  it("진입점(entry) 정확 일치 필터", async () => {
    const res = await server.inject({
      url: `/api/traces?entry=${encodeURIComponent("GET /orders")}`,
    });
    const body = res.json();
    expect(body.traces).toHaveLength(2);
    expect(body.traces.every((t: any) => t.entry_name === "GET /orders")).toBe(true);
  });

  it("진입점 여러 개 선택(멀티) 필터", async () => {
    const res = await server.inject({
      url:
        `/api/traces?entry=${encodeURIComponent("GET /orders")}` +
        `&entry=${encodeURIComponent("GET /health")}`,
    });
    const body = res.json();
    expect(body.traces.map((t: any) => t.id).sort()).toEqual(["t-new1", "t-new3", "t-old"]);
  });

  it("기간 구간(since~until) 필터", async () => {
    // 3시간 전 ± 30분 구간 → t-old만
    const res = await server.inject({
      url: `/api/traces?since=${NOW - 3.5 * 3600}&until=${NOW - 2.5 * 3600}`,
    });
    const body = res.json();
    expect(body.traces.map((t: any) => t.id)).toEqual(["t-old"]);
    expect(body.total).toBe(1);
  });

  it("추적 제외된 진입점의 기존 기록은 목록·후보에서 숨긴다", async () => {
    await server.inject({
      method: "POST", url: "/api/exclusions",
      payload: { entry_name: "GET /health" },
    });
    const res = await server.inject({ url: "/api/traces" });
    const body = res.json();
    expect(body.traces.some((t: any) => t.entry_name === "GET /health")).toBe(false);
    expect(body.facets.entries).not.toContain("GET /health");
    expect(body.total).toBe(3); // health 1건 제외
    // 정리 — 다른 테스트에 영향 없게 되돌린다
    await server.inject({
      method: "DELETE",
      url: `/api/exclusions?entry=${encodeURIComponent("GET /health")}`,
    });
  });

  it("서비스 필터", async () => {
    const res = await server.inject({ url: "/api/traces?service=node" });
    expect(res.json().traces.map((t: any) => t.id).sort()).toEqual(["t-new2", "t-new3"]);
  });

  it("limit과 total은 독립", async () => {
    const res = await server.inject({ url: "/api/traces?limit=1" });
    const body = res.json();
    expect(body.traces).toHaveLength(1);
    expect(body.total).toBe(4);
  });
});

describe("진입점 추적 제외 API", () => {
  it("추가 → 조회 → 삭제가 동작한다", async () => {
    const add = await server.inject({
      method: "POST", url: "/api/exclusions",
      payload: { entry_name: "GET /health" },
    });
    expect(add.statusCode).toBe(200);

    let list = (await server.inject({ url: "/api/exclusions" })).json();
    expect(list.entries).toEqual(["GET /health"]);

    // 중복 추가는 한 번만
    await server.inject({
      method: "POST", url: "/api/exclusions",
      payload: { entry_name: "GET /health" },
    });
    list = (await server.inject({ url: "/api/exclusions" })).json();
    expect(list.entries).toHaveLength(1);

    const del = await server.inject({
      method: "DELETE",
      url: `/api/exclusions?entry=${encodeURIComponent("GET /health")}`,
    });
    expect(del.statusCode).toBe(200);
    list = (await server.inject({ url: "/api/exclusions" })).json();
    expect(list.entries).toEqual([]);
  });

  it("빈 진입점은 거부한다", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/exclusions", payload: { entry_name: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
