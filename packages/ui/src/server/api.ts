// 개요: UI 서버의 REST API — 추적 DB를 읽어 화면에 필요한 형태로 돌려준다.
import Fastify, { type FastifyInstance } from "fastify";

import { DbHandle } from "./db.js";

export interface ServerOptions {
  dbPath: string;
}

/** 개요: 트레이스 행에 화면용 파생 값(소요시간)을 붙인다. */
function withDuration(row: Record<string, unknown>) {
  const started = row.started_at as number;
  const ended = row.ended_at as number | null;
  return {
    ...row,
    duration_ms: ended != null ? (ended - started) * 1000 : null,
  };
}

/** 개요: Fastify 서버를 만들어 API 라우트를 등록한다(listen은 호출자가). */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const handle = new DbHandle(opts.dbPath);

  app.addHook("onClose", async () => handle.close());

  app.get("/api/health", async () => ({
    ok: true,
    db: opts.dbPath,
    dbExists: handle.exists(),
  }));

  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    "/api/traces",
    async (req) => {
      const db = handle.get();
      if (!db) return { traces: [] };
      const q = req.query.q?.trim() || null;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const params: unknown[] = [];
      let where = "";
      if (q) {
        where = "WHERE t.entry_name LIKE '%' || ? || '%'";
        params.push(q);
      }
      params.push(limit, offset);
      const rows = db
        .prepare(
          `SELECT t.*,
                  (SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.id) AS span_count
           FROM traces t
           ${where}
           ORDER BY t.started_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params) as Record<string, unknown>[];
      return { traces: rows.map(withDuration) };
    },
  );

  app.get<{ Params: { id: string } }>("/api/traces/:id", async (req, reply) => {
    const db = handle.get();
    const trace = db
      ?.prepare("SELECT * FROM traces WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!db || !trace) {
      return reply.code(404).send({ error: "trace not found" });
    }
    const spans = db
      .prepare(
        `SELECT s.*, f.doc_overview, f.doc_logic, f.doc_note,
                f.file_path, f.line
         FROM spans s
         LEFT JOIN functions f ON f.id = s.function_id
         WHERE s.trace_id = ?
         ORDER BY s.seq`,
      )
      .all(req.params.id) as Record<string, unknown>[];
    return { trace: withDuration(trace), spans: spans.map(withDuration) };
  });

  return app;
}
