// 개요: UI 서버의 REST API — 추적 DB를 읽어 화면에 필요한 형태로 돌려준다.
import Fastify, { type FastifyInstance } from "fastify";

import { DbHandle } from "./db.js";

export interface ServerOptions {
  dbPath: string;
  /** 빌드된 웹 정적 파일 폴더. 지정 시 SPA 서빙(/api 외 경로는 index.html). */
  staticRoot?: string;
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

  if (opts.staticRoot) {
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: opts.staticRoot });
    // SPA fallback: /api가 아닌 미지의 경로는 index.html (새로고침 대응)
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return (reply as any).sendFile("index.html");
    });
  }

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

  app.get<{ Querystring: { q?: string } }>("/api/graph", async (req) => {
    const db = handle.get();
    if (!db) return { nodes: [], edges: [], truncated: false };
    const q = req.query.q?.trim();
    const params: unknown[] = [];
    let where = "";
    if (q) {
      where = "WHERE f.id LIKE '%' || ? || '%'";
      params.push(q);
    }
    const nodes = db
      .prepare(
        `SELECT f.id, f.qualified_name AS name, f.file_path, f.line,
                f.doc_overview, f.doc_logic, f.doc_note, f.is_entity_method,
                (SELECT COUNT(*) FROM spans s WHERE s.function_id = f.id) AS runtime_hits
         FROM functions f ${where}
         ORDER BY f.file_path, f.line
         LIMIT 301`,
      )
      .all(...params) as Record<string, unknown>[];
    const truncated = nodes.length > 300;
    if (truncated) nodes.pop();
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (
      db.prepare("SELECT caller_id AS source, callee_id AS target, kind, count FROM call_edges").all() as {
        source: string; target: string; kind: string; count: number;
      }[]
    ).filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges, truncated };
  });

  app.get("/api/entities", async () => {
    const db = handle.get();
    if (!db) return { entities: [] };
    const entities = db
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM entity_fields ef WHERE ef.entity_id = e.id) AS field_count,
                (SELECT COUNT(*) FROM entity_usages eu WHERE eu.entity_id = e.id) AS usage_count
         FROM entities e ORDER BY e.name`,
      )
      .all();
    return { entities };
  });

  app.get<{ Querystring: { id: string } }>(
    "/api/entities/detail",
    async (req, reply) => {
      const db = handle.get();
      const entity = db
        ?.prepare("SELECT * FROM entities WHERE id = ?")
        .get(req.query.id);
      if (!db || !entity) return reply.code(404).send({ error: "entity not found" });
      const fields = db
        .prepare("SELECT name, type, description FROM entity_fields WHERE entity_id = ?")
        .all(req.query.id);
      const relations = db
        .prepare(
          `SELECT e.* FROM entity_relations r JOIN entities e ON e.id = r.to_id
           WHERE r.from_id = ?`,
        )
        .all(req.query.id);
      const used_by = db
        .prepare(
          `SELECT u.function_id, u.role, f.qualified_name AS name, f.doc_overview, f.file_path, f.line
           FROM entity_usages u LEFT JOIN functions f ON f.id = u.function_id
           WHERE u.entity_id = ? ORDER BY u.role, f.file_path`,
        )
        .all(req.query.id);
      return { entity, fields, relations, used_by };
    },
  );

  app.get<{ Querystring: { id: string } }>("/api/functions", async (req, reply) => {
    const db = handle.get();
    const fn = db
      ?.prepare("SELECT * FROM functions WHERE id = ?")
      .get(req.query.id);
    if (!db || !fn) return reply.code(404).send({ error: "function not found" });
    const traces = db
      .prepare(
        `SELECT t.* FROM traces t
         WHERE t.id IN (SELECT DISTINCT s.trace_id FROM spans s WHERE s.function_id = ?)
         ORDER BY t.started_at DESC LIMIT 10`,
      )
      .all(req.query.id) as Record<string, unknown>[];
    return { function: fn, traces: traces.map(withDuration) };
  });

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
