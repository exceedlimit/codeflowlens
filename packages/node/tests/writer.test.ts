// 개요: 배치 writer 테스트 — 기록/flush/종료/불량 행 무시를 검증한다.
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BatchWriter, type SpanRow } from "../src/writer.js";

function span(id: string, seq: number, parent: string | null = null): SpanRow {
  return {
    id, trace_id: "t1", parent_id: parent, function_id: "app.ts::f", name: "f",
    started_at: 1, ended_at: 2, status: "ok",
    args_json: "{}", return_json: "null", error_json: null, seq,
  };
}

describe("BatchWriter", () => {
  it("trace/span/edge가 flush 후 DB에 반영된다", () => {
    const dir = mkdtempSync(join(tmpdir(), "flowlens-w-"));
    const dbPath = join(dir, "data.db");
    const w = new BatchWriter(dbPath);
    w.traceStart({ id: "t1", started_at: 1, entry_kind: "process", entry_name: "node x" });
    w.spanFinish(span("s1", 0));
    w.spanFinish(span("s2", 1, "s1"));
    w.runtimeEdge("app.ts::f", "app.ts::g");
    w.runtimeEdge("app.ts::f", "app.ts::g");
    w.traceEnd("t1", 2, "ok");
    w.close();

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT status FROM traces WHERE id='t1'").get()).toEqual({ status: "ok" });
    expect(db.prepare("SELECT COUNT(*) c FROM spans").get()).toEqual({ c: 2 });
    expect(
      db.prepare("SELECT count FROM call_edges WHERE kind='runtime'").get(),
    ).toEqual({ count: 2 });
    db.close();
  });

  it("불량 행이 섞여도 이후 기록이 계속된다", () => {
    const dir = mkdtempSync(join(tmpdir(), "flowlens-w-"));
    const w = new BatchWriter(join(dir, "data.db"));
    w.traceStart({ id: "t1", started_at: 1, entry_kind: "process", entry_name: "x" });
    w.spanFinish({ id: "bad" } as unknown as SpanRow);
    w.spanFinish(span("good", 0));
    w.close();
    const db = new Database(join(dir, "data.db"), { readonly: true });
    const ids = db.prepare("SELECT id FROM spans").all().map((r: any) => r.id);
    expect(ids).toContain("good");
    db.close();
  });

  it("못 쓰는 경로면 조용히 비활성화된다(fail-open)", () => {
    expect(() => {
      const w = new BatchWriter("/dev/null/nope/data.db");
      w.traceStart({ id: "t", started_at: 1, entry_kind: "process", entry_name: "x" });
      w.close();
    }).not.toThrow();
  });
});
