// 개요: UI 서버의 REST API — 추적 DB를 읽어 화면에 필요한 형태로 돌려준다.
import Fastify, { type FastifyInstance } from "fastify";

import { scheduleCleanup } from "./cleanup.js";
import { DbHandle } from "./db.js";
import { ScanRunner, detectScanners, inferProjectRoot } from "./scanner.js";
import { startCodeWatcher } from "./watcher.js";

export interface ServerOptions {
  dbPath: string;
  /** 빌드된 웹 정적 파일 폴더. 지정 시 SPA 서빙(/api 외 경로는 index.html). */
  staticRoot?: string;
  /** 스캔 대상 프로젝트 루트. 생략 시 DB 경로에서 유추한다. */
  projectRoot?: string;
  /** 스캔 명령 직접 지정(--scan-cmd). 자동 탐지가 실패할 때 쓴다. */
  scanCommand?: string;
  /** 소스 파일 변경 감지 시 자동 재스캔 (CLI 기본 켬, 테스트는 끔) */
  watch?: boolean;
  /** 변경 후 재스캔까지 기다리는 시간(ms) */
  watchDebounceMs?: number;
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

  const cleanupTimer = scheduleCleanup(() => handle.getWrite());

  // --- 코드맵 재스캔 (수동 버튼 + 파일 변경 감지) ------------------------
  const projectRoot = opts.projectRoot ?? inferProjectRoot(opts.dbPath);
  const runner = new ScanRunner(projectRoot, () =>
    detectScanners(projectRoot, { override: opts.scanCommand }),
  );
  const stopWatcher = opts.watch
    ? (runner.watching = true,
      startCodeWatcher(projectRoot, () => void runner.run(), {
        debounceMs: opts.watchDebounceMs,
      }))
    : null;

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    stopWatcher?.();
    handle.close();
  });

  app.get("/api/scan/status", async () => runner.status());

  app.post("/api/scan", async () => {
    const result = await runner.run();
    return { ...result, status: runner.status() };
  });

  // --- 설정 (M5) -------------------------------------------------------
  app.get("/api/settings", async () => {
    const db = handle.get();
    const rows = db
      ? (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
      : [];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      retention_days: Number(map.retention_days ?? 7),
      value_max_bytes: Number(map.value_max_bytes ?? 65536),
    };
  });

  app.put<{ Body: { retention_days?: number; value_max_bytes?: number } }>(
    "/api/settings",
    async (req, reply) => {
      const db = handle.getWrite();
      if (!db) return reply.code(409).send({ error: "추적 DB가 아직 없습니다" });
      const updates: [string, number | undefined][] = [
        ["retention_days", req.body?.retention_days],
        ["value_max_bytes", req.body?.value_max_bytes],
      ];
      for (const [key, value] of updates) {
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value <= 0) {
          return reply.code(400).send({ error: `${key}는 양수여야 합니다` });
        }
        db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").run(key, String(Math.floor(value)));
      }
      return { ok: true };
    },
  );

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

  // --- 브라우저 이벤트 수집 (M4) --------------------------------------
  // text/plain으로 받는다: 브라우저에서 CORS preflight 없는 단순 요청이 되도록.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/client-events", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    try {
      const ev = JSON.parse(String(req.body));
      const db = handle.getWrite();
      if (db && ev && ev.id && ev.trace_id) {
        db.prepare(
          `INSERT OR REPLACE INTO client_events (id, trace_id, page_url, method, url, started_at, duration_ms, status)
           VALUES (@id, @trace_id, @page_url, @method, @url, @started_at, @duration_ms, @status)`,
        ).run({
          page_url: "", method: null, url: null,
          started_at: 0, duration_ms: null, status: null,
          ...ev,
        });
      }
    } catch {
      /* 수집 실패는 조용히 무시 — 앱/브라우저에 영향 없음 */
    }
    return { ok: true };
  });

  app.get<{
    Querystring: {
      q?: string; limit?: string; offset?: string;
      since?: string; until?: string;
      entry?: string | string[]; service?: string;
    };
  }>(
    "/api/traces",
    async (req) => {
      const db = handle.get();
      if (!db) return { traces: [], total: 0, facets: { entries: [], services: [] } };
      const q = req.query.q?.trim() || null;
      const entries = (Array.isArray(req.query.entry) ? req.query.entry : [req.query.entry])
        .map((e) => e?.trim())
        .filter((e): e is string => Boolean(e));
      const service = req.query.service?.trim() || null;
      const since = Number(req.query.since) || null;
      const until = Number(req.query.until) || null;
      const limit = Math.min(Number(req.query.limit) || 100, 1000);
      const offset = Number(req.query.offset) || 0;
      const excluded = readExclusions();

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (q) { conditions.push("t.entry_name LIKE '%' || ? || '%'"); params.push(q); }
      if (entries.length > 0) {
        conditions.push(`t.entry_name IN (${entries.map(() => "?").join(",")})`);
        params.push(...entries);
      }
      if (service) { conditions.push("t.service = ?"); params.push(service); }
      if (since) { conditions.push("t.started_at >= ?"); params.push(since); }
      if (until) { conditions.push("t.started_at <= ?"); params.push(until); }
      if (excluded.length > 0) {
        // 추적 제외된 진입점의 과거 기록도 목록에서 숨긴다
        conditions.push(`t.entry_name NOT IN (${excluded.map(() => "?").join(",")})`);
        params.push(...excluded);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const total = (db
        .prepare(`SELECT COUNT(*) AS c FROM traces t ${where}`)
        .get(...params) as { c: number }).c;
      const rows = db
        .prepare(
          `SELECT t.*,
                  (SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.id) AS span_count
           FROM traces t
           ${where}
           ORDER BY t.started_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Record<string, unknown>[];

      // 필터 드롭다운용 후보 목록 (추적 제외 진입점은 후보에서도 뺀다)
      const facetEntries = (db
        .prepare("SELECT DISTINCT entry_name FROM traces ORDER BY entry_name LIMIT 200")
        .all() as { entry_name: string }[])
        .map((r) => r.entry_name)
        .filter((e) => !excluded.includes(e));
      const services = (db
        .prepare("SELECT DISTINCT service FROM traces WHERE service IS NOT NULL")
        .all() as { service: string }[]).map((r) => r.service);
      return {
        traces: rows.map(withDuration),
        total,
        facets: { entries: facetEntries, services },
      };
    },
  );

  // --- 진입점 추적 제외 목록 (settings의 excluded_entries JSON) -----------
  const readExclusions = (): string[] => {
    const db = handle.get();
    if (!db) return [];
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'excluded_entries'")
      .get() as { value: string } | undefined;
    try {
      const parsed = JSON.parse(row?.value ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeExclusions = (entries: string[]): boolean => {
    const db = handle.getWrite();
    if (!db) return false;
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('excluded_entries', ?)").run(
      JSON.stringify(entries),
    );
    return true;
  };

  app.get("/api/exclusions", async () => ({ entries: readExclusions() }));

  app.post<{ Body: { entry_name?: string } }>("/api/exclusions", async (req, reply) => {
    const entry = req.body?.entry_name?.trim();
    if (!entry) return reply.code(400).send({ error: "entry_name이 필요합니다" });
    const entries = readExclusions();
    if (!entries.includes(entry)) entries.push(entry);
    if (!writeExclusions(entries)) {
      return reply.code(409).send({ error: "추적 DB가 아직 없습니다" });
    }
    return { ok: true, entries };
  });

  app.delete<{ Querystring: { entry?: string } }>("/api/exclusions", async (req, reply) => {
    const entry = req.query.entry?.trim();
    if (!entry) return reply.code(400).send({ error: "entry가 필요합니다" });
    const entries = readExclusions().filter((e) => e !== entry);
    if (!writeExclusions(entries)) {
      return reply.code(409).send({ error: "추적 DB가 아직 없습니다" });
    }
    return { ok: true, entries };
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/api/graph", async (req) => {
    const db = handle.get();
    if (!db) return { nodes: [], edges: [], truncated: false };
    const q = req.query.q?.trim();
    const limit = Math.min(Number(req.query.limit) || 300, 10000);
    const params: unknown[] = [];
    let where = "";
    if (q) {
      where = "WHERE f.id LIKE '%' || ? || '%'";
      params.push(q);
    }
    // 실행 횟수는 한 번의 GROUP BY로 집계 — 함수마다 spans를 다시 세면(상관 서브쿼리)
    // 인덱스 없는 DB에서 함수 수 × 스팬 수만큼 느려진다
    const hitRows = db
      .prepare("SELECT function_id, COUNT(*) AS hits FROM spans GROUP BY function_id")
      .all() as { function_id: string; hits: number }[];
    const hits = new Map(hitRows.map((r) => [r.function_id, r.hits]));
    const nodes = db
      .prepare(
        `SELECT f.id, f.qualified_name AS name, f.file_path, f.line,
                f.doc_overview, f.doc_logic, f.doc_note, f.is_entity_method
         FROM functions f ${where}
         ORDER BY f.file_path, f.line
         LIMIT ${limit + 1}`,
      )
      .all(...params) as Record<string, unknown>[];
    for (const n of nodes) n.runtime_hits = hits.get(n.id as string) ?? 0;
    const truncated = nodes.length > limit;
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
    if (!db) return { entities: [], relations: [] };
    const entities = db
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM entity_fields ef WHERE ef.entity_id = e.id) AS field_count,
                (SELECT COUNT(*) FROM entity_usages eu WHERE eu.entity_id = e.id) AS usage_count
         FROM entities e ORDER BY e.name`,
      )
      .all();
    const relations = db.prepare("SELECT from_id, to_id, kind FROM entity_relations").all();
    return { entities, relations };
  });

  app.get("/api/coverage", async () => {
    const db = handle.get();
    if (!db) return { languages: [], undocumented: [] };
    const languages = (db
      .prepare(
        `SELECT language, COUNT(*) AS total,
                SUM(CASE WHEN doc_overview IS NOT NULL THEN 1 ELSE 0 END) AS documented
         FROM functions GROUP BY language`,
      )
      .all() as { language: string; total: number; documented: number }[])
      .map((l) => ({
        ...l,
        coverage: l.total ? Math.round((l.documented / l.total) * 1000) / 10 : 100,
      }));
    const undocumented = db
      .prepare(
        `SELECT id, language, file_path, qualified_name, line
         FROM functions WHERE doc_overview IS NULL
         ORDER BY file_path, line LIMIT 100`,
      )
      .all();
    return { languages, undocumented };
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
    // 프론트에서 시작된 요청이면 브라우저 쪽 기록(페이지 출처)을 함께 준다
    const clientEvent = trace.client_trace_id
      ? db
          .prepare("SELECT * FROM client_events WHERE trace_id = ?")
          .get(trace.client_trace_id) ?? null
      : null;
    return {
      trace: withDuration(trace),
      spans: spans.map(withDuration),
      client_event: clientEvent,
    };
  });

  return app;
}
