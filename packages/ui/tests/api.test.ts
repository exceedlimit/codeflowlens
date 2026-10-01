// 개요: UI 서버 REST API 테스트 — 픽스처 DB를 만들어 목록/상세/헬스 응답을 검증한다.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

const T0 = Date.now() / 1000 - 60; // 정리 스케줄러에 지워지지 않는 최근 시각


let dbPath: string;
let server: Awaited<ReturnType<typeof buildServer>>;

function seed(path: string) {
  const db = new Database(path);
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO traces (id, started_at, ended_at, status, entry_kind, entry_name, http_method, http_path, http_status, service)
     VALUES ('t1', ${T0}, ${T0 + 0.5}, 'ok', 'http', 'GET /orders', 'GET', '/orders', 200, 'python')`,
  ).run();
  db.prepare(
    `INSERT INTO traces (id, started_at, ended_at, status, entry_kind, entry_name, service)
     VALUES ('t2', ${T0 + 100}, ${T0 + 100.2}, 'error', 'process', 'python demo.py', 'python')`,
  ).run();
  db.prepare(
    `INSERT INTO functions (id, language, file_path, qualified_name, line, doc_overview)
     VALUES ('app.py::handler', 'python', 'app.py', 'handler', 10, '주문 목록을 돌려준다.')`,
  ).run();
  const span = db.prepare(
    `INSERT INTO spans (id, trace_id, parent_id, function_id, name, started_at, ended_at, status, args_json, return_json, seq)
     VALUES (?, 't1', ?, ?, ?, ?, ?, 'ok', '{}', 'null', ?)`,
  );
  span.run("s1", null, "app.py::handler", "handler", T0, T0 + 0.4, 0);
  span.run("s2", "s1", "app.py::helper", "helper", T0 + 0.1, T0 + 0.3, 1);
  db.close();
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeflowlens-ui-test-"));
  dbPath = join(dir, "data.db");
  seed(dbPath);
  server = await buildServer({ dbPath });
});

afterAll(async () => {
  await server.close();
});

describe("GET /api/health", () => {
  it("DB 경로와 존재 여부를 알려준다", async () => {
    const res = await server.inject({ url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.dbExists).toBe(true);
  });
});

describe("GET /api/traces", () => {
  it("최신순 목록에 span_count와 duration_ms가 포함된다", async () => {
    const res = await server.inject({ url: "/api/traces" });
    expect(res.statusCode).toBe(200);
    const { traces } = res.json();
    expect(traces).toHaveLength(2);
    expect(traces[0].id).toBe("t2"); // 최신이 먼저
    expect(traces[1].span_count).toBe(2);
    expect(traces[1].duration_ms).toBeCloseTo(500, 0);
  });

  it("q로 entry_name 부분검색이 된다", async () => {
    const res = await server.inject({ url: "/api/traces?q=orders" });
    const { traces } = res.json();
    expect(traces).toHaveLength(1);
    expect(traces[0].id).toBe("t1");
  });
});

describe("GET /api/traces/:id", () => {
  it("trace + seq순 spans + 함수 주석(doc_overview)을 돌려준다", async () => {
    const res = await server.inject({ url: "/api/traces/t1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trace.entry_name).toBe("GET /orders");
    expect(body.spans).toHaveLength(2);
    expect(body.spans[0].id).toBe("s1");
    expect(body.spans[0].doc_overview).toBe("주문 목록을 돌려준다.");
    expect(body.spans[1].doc_overview).toBeNull(); // functions에 없는 함수
  });

  it("없는 id는 404", async () => {
    const res = await server.inject({ url: "/api/traces/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("DB 파일이 아직 없을 때", () => {
  it("빈 목록과 dbExists=false를 돌려준다(서버는 죽지 않는다)", async () => {
    const empty = await buildServer({ dbPath: join(tmpdir(), "no-such-dir", "no.db") });
    const health = await empty.inject({ url: "/api/health" });
    expect(health.json().dbExists).toBe(false);
    const res = await empty.inject({ url: "/api/traces" });
    expect(res.json().traces).toEqual([]);
    await empty.close();
  });
});
