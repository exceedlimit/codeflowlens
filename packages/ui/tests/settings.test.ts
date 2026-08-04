// 개요: 설정 API와 데이터 정리(보존 주기) 테스트.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";
import { cleanupOldData } from "../src/server/cleanup.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

let dbPath: string;

function seed(retentionDays = 7) {
  const dir = mkdtempSync(join(tmpdir(), "flowlens-set-"));
  dbPath = join(dir, "data.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO settings VALUES ('retention_days', ?)").run(String(retentionDays));
  db.prepare("INSERT INTO settings VALUES ('value_max_bytes', '65536')").run();

  const now = Date.now() / 1000;
  const old = now - 10 * 86400; // 10일 전
  const ins = db.prepare(
    "INSERT INTO traces (id, started_at, entry_kind, entry_name) VALUES (?, ?, 'http', 'GET /x')",
  );
  ins.run("old-t", old);
  ins.run("new-t", now);
  const spans = db.prepare(
    "INSERT INTO spans (id, trace_id, function_id, name, started_at, seq) VALUES (?, ?, 'a::f', 'f', ?, 0)",
  );
  spans.run("old-s", "old-t", old);
  spans.run("new-s", "new-t", now);
  db.prepare(
    "INSERT INTO client_events (id, trace_id, page_url, started_at) VALUES ('old-e', 'x', 'p', ?)",
  ).run(old);
  db.prepare(
    "INSERT INTO functions (id, language, file_path, qualified_name) VALUES ('a::f', 'python', 'a', 'f')",
  ).run();
  db.close();
}

beforeEach(() => seed());

describe("설정 API", () => {
  it("GET이 현재 설정을 준다", async () => {
    const server = await buildServer({ dbPath });
    const res = await server.inject({ url: "/api/settings" });
    expect(res.json()).toMatchObject({ retention_days: 7, value_max_bytes: 65536 });
    await server.close();
  });

  it("PUT이 저장하고, 잘못된 값은 거부한다", async () => {
    const server = await buildServer({ dbPath });
    const ok = await server.inject({
      method: "PUT", url: "/api/settings",
      payload: { retention_days: 14 },
    });
    expect(ok.statusCode).toBe(200);
    expect((await server.inject({ url: "/api/settings" })).json().retention_days).toBe(14);

    const bad = await server.inject({
      method: "PUT", url: "/api/settings",
      payload: { retention_days: -1 },
    });
    expect(bad.statusCode).toBe(400);
    await server.close();
  });
});

describe("cleanupOldData", () => {
  it("보존 주기 지난 실행 기록만 지우고 코드맵은 유지한다", () => {
    const db = new Database(dbPath);
    const removed = cleanupOldData(db);
    expect(removed.traces).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM traces").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT id FROM traces").get()).toEqual({ id: "new-t" });
    expect(db.prepare("SELECT COUNT(*) c FROM spans").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) c FROM client_events").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM functions").get()).toEqual({ c: 1 }); // 코드맵 유지
    db.close();
  });
});
