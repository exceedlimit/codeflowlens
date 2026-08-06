-- FlowLens 공통 스키마 v1 (언어 중립). 모든 추적기/UI가 이 계약을 따른다.
-- 변경 절차: packages/schema/README.md 참고 (schema_version 증가 + 각 패키지 사본 갱신)
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,                      -- uuid hex
  started_at REAL NOT NULL,                 -- unix epoch seconds
  ended_at REAL,
  status TEXT NOT NULL DEFAULT 'running',   -- running | ok | error
  entry_kind TEXT NOT NULL,                 -- process | http | event(웹소켓·타이머 등 외부 이벤트)
  entry_name TEXT NOT NULL,                 -- 'python main.py' | 'GET /orders' | 'onMessage'
  http_method TEXT, http_path TEXT, http_status INTEGER,
  source TEXT NOT NULL DEFAULT 'backend',   -- backend | browser(M4)
  client_trace_id TEXT,                     -- x-flowlens-trace 헤더(M4)
  service TEXT                              -- python | node
);
CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(started_at DESC);

CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_id TEXT,                           -- NULL = 트레이스 루트 직속
  function_id TEXT NOT NULL,                -- functions.id (정적 분석 전이어도 기록)
  name TEXT NOT NULL,                       -- qualified name
  started_at REAL NOT NULL, ended_at REAL,
  status TEXT NOT NULL DEFAULT 'ok',        -- ok | error
  args_json TEXT, return_json TEXT, error_json TEXT,  -- error: {type,message,stack}
  seq INTEGER NOT NULL                      -- 트레이스 내 호출 순번(트리 정렬용)
);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id, seq);

CREATE TABLE IF NOT EXISTS functions (      -- 정적 분석 결과(M2). M1은 조인만 준비
  id TEXT PRIMARY KEY,                      -- '<relpath>::<qualname>'
  language TEXT NOT NULL,                   -- python | typescript
  file_path TEXT NOT NULL, qualified_name TEXT NOT NULL, line INTEGER,
  doc_overview TEXT, doc_logic TEXT, doc_note TEXT,
  is_entity_method INTEGER NOT NULL DEFAULT 0,
  updated_at REAL
);

CREATE TABLE IF NOT EXISTS call_edges (
  caller_id TEXT NOT NULL, callee_id TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- static(M2) | runtime
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (caller_id, callee_id, kind)
);

CREATE TABLE IF NOT EXISTS entities (       -- M2
  id TEXT PRIMARY KEY, language TEXT NOT NULL,
  file_path TEXT NOT NULL, name TEXT NOT NULL,
  doc_overview TEXT, doc_note TEXT, updated_at REAL
);
CREATE TABLE IF NOT EXISTS entity_fields (  -- M2 ('파라미터' 주석 파싱 결과 포함)
  entity_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, description TEXT,
  PRIMARY KEY (entity_id, name)
);
CREATE TABLE IF NOT EXISTS entity_relations ( -- M2 (필드 타입 참조로 추출)
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'ref',
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE TABLE IF NOT EXISTS entity_usages (  -- M2
  entity_id TEXT NOT NULL, function_id TEXT NOT NULL, role TEXT NOT NULL, -- param|return
  PRIMARY KEY (entity_id, function_id, role)
);

CREATE TABLE IF NOT EXISTS client_events (  -- M4 (브라우저 API 호출 기록)
  id TEXT PRIMARY KEY, trace_id TEXT,
  page_url TEXT NOT NULL, method TEXT, url TEXT,
  started_at REAL NOT NULL, duration_ms REAL, status INTEGER
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- 최초 생성 시 코드에서 seed: retention_days=7, value_max_bytes=65536
