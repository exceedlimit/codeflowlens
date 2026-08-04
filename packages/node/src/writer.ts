// 개요: 추적 이벤트를 모아 배치로 SQLite에 기록하는 writer (better-sqlite3, 동기).
// 로직: 이벤트를 버퍼에 쌓고 250ms 타이머와 종료 훅에서 한 트랜잭션으로 반영한다.
// 참고: 오류 시 스스로 비활성화된다(fail-open) — 사용자 앱을 절대 죽이지 않는다.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface TraceRow {
  id: string; started_at: number; entry_kind: string; entry_name: string;
  http_method?: string | null; http_path?: string | null;
  client_trace_id?: string | null; service?: string;
}
export interface SpanRow {
  id: string; trace_id: string; parent_id: string | null; function_id: string;
  name: string; started_at: number; ended_at: number; status: string;
  args_json: string | null; return_json: string | null; error_json: string | null;
  seq: number;
}

type Event =
  | { kind: "trace_start"; row: TraceRow }
  | { kind: "span_finish"; row: SpanRow }
  | { kind: "trace_end"; id: string; ended_at: number; status: string; http_status?: number | null }
  | { kind: "runtime_edge"; caller: string; callee: string };

const FLUSH_MS = 250;

export class BatchWriter {
  private buffer: Event[] = [];
  private db: Database.Database | null = null;
  private disabled = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private dbPath: string) {
    try {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("synchronous = NORMAL");
      let schema = "";
      for (const rel of ["./db/schema.sql", "../db/schema.sql"]) {
        try {
          schema = readFileSync(new URL(rel, import.meta.url), "utf-8");
          break;
        } catch { /* 다음 후보 */ }
      }
      this.db.exec(schema);
      const ver = this.db.prepare("SELECT version FROM schema_version").get();
      if (!ver) {
        this.db.prepare("INSERT INTO schema_version VALUES (1)").run();
        const ins = this.db.prepare("INSERT OR IGNORE INTO settings VALUES (?, ?)");
        ins.run("retention_days", "7");
        ins.run("value_max_bytes", "65536");
      }
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref(); // 타이머가 프로세스 종료를 막지 않도록
      process.once("exit", () => this.close());
    } catch {
      this.disabled = true;
    }
  }

  traceStart(row: TraceRow): void { this.push({ kind: "trace_start", row }); }
  spanFinish(row: SpanRow): void { this.push({ kind: "span_finish", row }); }
  traceEnd(id: string, ended_at: number, status: string, http_status?: number | null): void {
    this.push({ kind: "trace_end", id, ended_at, status, http_status });
  }
  runtimeEdge(caller: string, callee: string): void {
    this.push({ kind: "runtime_edge", caller, callee });
  }

  /** 개요: 잔여 버퍼를 기록하고 닫는다(exit 훅에서 자동 호출). */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
    try { this.db?.close(); } catch { /* fail-open */ }
    this.db = null;
  }

  private push(e: Event): void {
    if (!this.disabled) this.buffer.push(e);
  }

  flush(): void {
    if (this.disabled || !this.db || this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      const db = this.db;
      const tx = db.transaction((events: Event[]) => {
        for (const e of events) {
          try { this.apply(db, e); } catch { /* 나쁜 행 1건은 버린다 */ }
        }
      });
      tx(batch);
    } catch {
      this.disabled = true;
    }
  }

  private apply(db: Database.Database, e: Event): void {
    if (e.kind === "trace_start") {
      db.prepare(
        `INSERT OR REPLACE INTO traces (id, started_at, entry_kind, entry_name, http_method, http_path, client_trace_id, service)
         VALUES (@id, @started_at, @entry_kind, @entry_name, @http_method, @http_path, @client_trace_id, @service)`,
      ).run({
        http_method: null, http_path: null, client_trace_id: null, service: "node",
        ...e.row,
      });
    } else if (e.kind === "span_finish") {
      db.prepare(
        `INSERT INTO spans (id, trace_id, parent_id, function_id, name, started_at, ended_at, status, args_json, return_json, error_json, seq)
         VALUES (@id, @trace_id, @parent_id, @function_id, @name, @started_at, @ended_at, @status, @args_json, @return_json, @error_json, @seq)`,
      ).run(e.row);
    } else if (e.kind === "trace_end") {
      db.prepare(
        "UPDATE traces SET ended_at = ?, status = ?, http_status = COALESCE(?, http_status) WHERE id = ?",
      ).run(e.ended_at, e.status, e.http_status ?? null, e.id);
    } else {
      db.prepare(
        `INSERT INTO call_edges (caller_id, callee_id, kind, count) VALUES (?, ?, 'runtime', 1)
         ON CONFLICT(caller_id, callee_id, kind) DO UPDATE SET count = count + 1`,
      ).run(e.caller, e.callee);
    }
  }
}
