// 개요: 브라우저 이벤트 수집 엔드포인트와 프론트↔백 트레이스 조인 테스트.
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

let server: Awaited<ReturnType<typeof buildServer>>;
let dbPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowlens-ce-"));
  dbPath = join(dir, "data.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  // 백엔드 추적기가 남긴 트레이스 (client_trace_id 포함)
  db.prepare(
    `INSERT INTO traces (id, started_at, ended_at, status, entry_kind, entry_name, client_trace_id)
     VALUES ('bk1', 100.0, 100.5, 'ok', 'http', 'POST /orders', 'cli-abc')`,
  ).run();
  db.close();
  server = await buildServer({ dbPath });
});

afterAll(async () => server.close());

describe("POST /api/client-events", () => {
  it("text/plain JSON을 client_events에 저장하고 CORS를 허용한다", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/client-events",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({
        id: "ev1", trace_id: "cli-abc",
        page_url: "http://localhost:5173/orders", method: "POST", url: "/orders",
        started_at: 99.9, duration_ms: 42.5, status: 200,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT * FROM client_events WHERE id='ev1'").get() as any;
    expect(row.trace_id).toBe("cli-abc");
    expect(row.page_url).toBe("http://localhost:5173/orders");
    db.close();
  });

  it("잘못된 본문은 무시하고 200 (앱에 영향 없음)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/client-events",
      headers: { "content-type": "text/plain" },
      payload: "not-json",
    });
    expect(res.statusCode).toBe(200);
  });

  it("DB가 없으면 조용히 버린다", async () => {
    const empty = await buildServer({ dbPath: join(tmpdir(), "nope-dir", "no.db") });
    const res = await empty.inject({
      method: "POST", url: "/api/client-events",
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify({ id: "x", trace_id: "y", page_url: "z", started_at: 1 }),
    });
    expect(res.statusCode).toBe(200);
    await empty.close();
  });
});

describe("프론트↔백 조인", () => {
  it("트레이스 상세에 client_event(페이지 출처)가 포함된다", async () => {
    const res = await server.inject({ url: "/api/traces/bk1" });
    const body = res.json();
    expect(body.client_event).toBeTruthy();
    expect(body.client_event.page_url).toBe("http://localhost:5173/orders");
    expect(body.client_event.duration_ms).toBe(42.5);
  });

  it("연결 없는 트레이스는 client_event가 null", async () => {
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO traces (id, started_at, entry_kind, entry_name) VALUES ('bk2', 1, 'process', 'x')",
    ).run();
    db.close();
    const res = await server.inject({ url: "/api/traces/bk2" });
    expect(res.json().client_event).toBeNull();
  });
});
