# M1 구현 계획 — 공통 스키마 + Python 추적기 + 최소 UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데모 FastAPI 앱을 `flowlens run uvicorn main:app`으로 실행하면 함수 호출 트리·파라미터·리턴값이 SQLite에 기록되고, `npx @flowlens/ui`로 띄운 웹 화면에서 트레이스 목록/상세(호출 트리)를 볼 수 있다.

**Architecture:** (docs/PRD.md 5절) 언어 중립 SQLite 스키마(packages/schema)를 계약으로 삼고, Python 추적기(sys.monitoring 3.12+/sys.settrace 3.9~3.11)가 배치 writer로 직접 기록, Node UI 서버(Fastify)가 읽어서 React 화면에 표시. 추적기는 fail-open(오류 시 앱을 절대 죽이지 않음).

**Tech Stack:** Python 표준 라이브러리만(sys.monitoring/ast/sqlite3), hatchling · Node 20+, Fastify, better-sqlite3, React+Vite+TS, vitest/pytest

**완료 기준 (PRD 12절 M1):** 데모 FastAPI 앱을 `flowlens run`으로 실행 → UI에서 호출 트리·파라미터 확인

---

## 설계 확정 사항 (이 계획 전체에서 일관되게 사용)

- **function_id**: `"<프로젝트 루트 기준 상대경로>::<qualified_name>"` 예: `app/services.py::OrderService.add_stock`
- **시각**: unix epoch 초(REAL, `time.time()`), 밀리초 계산은 조회 시
- **스팬 기록 시점**: 함수가 *끝났을 때* 1회 INSERT (시작 시 쓰지 않음 → 쓰기 절반). 트레이스 행은 시작 시 INSERT, 끝날 때 UPDATE
- **부모 추적**: frame → span_id 맵. 새 호출의 부모 = 가장 가까운 "추적된 조상 frame"의 스팬. 조상이 없으면(백그라운드 태스크 등) parent_id=NULL(트레이스 루트 직속). async는 frame 체인으로 자연스럽게 연결됨
- **qualified_name**: 3.11+는 `code.co_qualname`, 3.9/3.10은 `co_name` + frame 로컬의 `self`/`cls` 타입명으로 근사
- **값 직렬화**: 파라미터별 개별 직렬화(JSON 우선 → 실패 시 repr), 값 1개 기본 상한 64KB 초과 시 잘라내고 `"...(truncated)"` 부착
- **Python 3.12+**: `sys.monitoring` (비프로젝트 코드는 `DISABLE` 반환으로 코드객체 단위 이벤트 차단 → 저오버헤드) / **3.9~3.11**: `sys.settrace` + `threading.settrace`
- **UI 포트**: 7411 · **DB 경로**: `<프로젝트>/.flowlens/data.db`

## 파일 구조

```
packages/schema/schema.sql            # 언어 중립 DDL (계약의 원본)
packages/schema/README.md             # 필드 의미 문서
packages/python/
  pyproject.toml
  src/flowlens/
    __init__.py  _version.py
    cli.py                            # argparse: flowlens run ... (init/check/scan은 M2)
    paths.py                          # 프로젝트 루트/.flowlens 경로
    db/schema.sql                     # schema/schema.sql의 사본 (테스트로 동기화 검증)
    db/connect.py                     # WAL 연결 + 스키마 적용
    db/writer.py                      # 배치 writer (백그라운드 스레드)
    tracer/serialize.py               # 값 직렬화
    tracer/filter.py                  # 프로젝트 코드 필터
    tracer/core.py                    # TraceSession: 스팬 조립, frame→span 맵
    tracer/backend_settrace.py        # 3.9~3.11 백엔드
    tracer/backend_monitoring.py      # 3.12+ 백엔드
    tracer/asgi.py                    # Starlette/FastAPI 요청 → 트레이스 그룹핑
    bootstrap.py                      # 환경변수 읽고 추적기 설치 (sitecustomize가 호출)
    run.py                            # flowlens run 구현
  tests/ (아래 각 태스크에 명시)
packages/ui/
  package.json  tsconfig.json
  src/server/index.ts  api.ts  db.ts  cli.ts
  src/web/ (Vite React 앱: pages/TraceList.tsx, pages/TraceDetail.tsx ...)
  tests/api.test.ts
examples/fastapi-demo/main.py  app/ ...
```

---

### Task 1: 공통 스키마 (packages/schema)

**Files:** Create `packages/schema/schema.sql`, `packages/schema/README.md`

- [x] **1-1. schema.sql 작성** — 아래 DDL 전체(M2~M5용 테이블 포함, 스키마는 M1에서 확정):

```sql
-- FlowLens 공통 스키마 v1 (언어 중립). 모든 추적기/UI가 이 계약을 따른다.
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,                      -- uuid hex
  started_at REAL NOT NULL,                 -- unix epoch seconds
  ended_at REAL,
  status TEXT NOT NULL DEFAULT 'running',   -- running | ok | error
  entry_kind TEXT NOT NULL,                 -- process | http
  entry_name TEXT NOT NULL,                 -- 'python main.py' | 'GET /orders'
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
```

- [x] **1-2. README.md** — 각 테이블/필드 의미 + function_id 규칙 + "스키마 변경 시 schema_version 올리고 양쪽 사본 갱신" 절차 문서화
- [x] **1-3. 커밋** `M1: 공통 SQLite 스키마 v1`

### Task 2: Python 패키지 뼈대

**Files:** Create `packages/python/pyproject.toml`, `src/flowlens/__init__.py`, `_version.py`, `tests/test_smoke.py`

- [x] **2-1.** pyproject.toml (hatchling, `[project.scripts] flowlens = "flowlens.cli:main"`, requires-python `>=3.9`, dev deps: pytest) + 빈 패키지 + `tests/test_smoke.py::test_import` 작성
- [x] **2-2.** `cd packages/python && python -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/python -m pytest` → PASS 확인
- [x] **2-3.** `src/flowlens/db/schema.sql`로 스키마 사본 복사 + `tests/test_schema_sync.py`:

```python
def test_schema_copy_is_in_sync():
    """개요: 패키지에 내장된 스키마 사본이 계약 원본과 동일한지 검증한다."""
    root = Path(__file__).parents[3]  # packages/python/tests -> repo root
    original = (root / "packages/schema/schema.sql").read_text()
    vendored = (Path(flowlens.__file__).parent / "db/schema.sql").read_text()
    assert original == vendored
```

- [x] **2-4.** 커밋 `M1: Python 패키지 뼈대 + 스키마 동기화 테스트`

### Task 3: DB 연결 (db/connect.py)

**Test:** `tests/test_connect.py`

- [x] **3-1. 실패 테스트**: `open_db(tmp_path/"x/data.db")` → 부모 폴더 자동 생성, WAL 모드, 전체 테이블 존재, `schema_version=1`, settings에 retention_days=7 seed, 두 번 열어도 안전(idempotent)
- [x] **3-2. 구현**:

```python
def open_db(path: Path) -> sqlite3.Connection:
    """개요: 추적 데이터 저장용 SQLite 연결을 연다.
    로직: 폴더를 만들고 WAL/busy_timeout을 설정한 뒤, 스키마가 없으면 생성하고 기본 설정값을 심는다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript((Path(__file__).parent / "schema.sql").read_text())
    cur = conn.execute("SELECT version FROM schema_version")
    if cur.fetchone() is None:
        conn.execute("INSERT INTO schema_version VALUES (1)")
        conn.executemany("INSERT OR IGNORE INTO settings VALUES (?,?)",
                         [("retention_days", "7"), ("value_max_bytes", "65536")])
        conn.commit()
    return conn
```

- [x] **3-3.** PASS 확인 → 커밋 `M1: DB 연결(WAL) + 스키마 적용`

### Task 4: 값 직렬화 (tracer/serialize.py)

**Test:** `tests/test_serialize.py`

- [x] **4-1. 실패 테스트** — 케이스: dict/list/str/int 그대로 JSON, dataclass·Pydantic류(`__dict__` 있는 객체)는 `{"__type__": "Order", ...필드}`, 직렬화 불가(소켓 등)는 `{"__repr__": "..."}`, 64KB 초과 문자열은 잘리고 `"...(truncated)"`로 끝남, 순환 참조여도 예외가 밖으로 절대 안 나감
- [x] **4-2. 구현** — 핵심:

```python
def serialize_value(value, max_bytes=65536) -> str:
    """개요: 파라미터/리턴값을 저장 가능한 JSON 문자열로 바꾼다.
    로직: JSON 변환을 시도하고, 안 되는 객체는 타입명+필드 또는 repr로 대체한 뒤 크기 상한을 적용한다.
    참고: 어떤 입력에도 예외를 던지지 않는다(fail-open)."""
    def fallback(o):
        d = getattr(o, "__dict__", None)
        if isinstance(d, dict):
            return {"__type__": type(o).__name__, **{k: v for k, v in list(d.items())[:50] if not k.startswith("_")}}
        return {"__repr__": repr(o)[:1000]}
    try:
        s = json.dumps(value, ensure_ascii=False, default=fallback)
    except Exception:
        try: s = json.dumps({"__repr__": repr(value)[:1000]})
        except Exception: s = '{"__repr__": "<unserializable>"}'
    if len(s.encode("utf-8", "ignore")) > max_bytes:
        s = s.encode("utf-8", "ignore")[:max_bytes].decode("utf-8", "ignore") + "...(truncated)"
    return s

def serialize_args(frame_locals: dict, argnames: list, max_bytes=65536) -> str:
    # {인자명: 개별 serialize} — 인자 하나가 커도 다른 인자를 살린다
```

- [x] **4-3.** PASS → 커밋 `M1: 값 직렬화(fail-open, 크기 상한)`

### Task 5: 배치 Writer (db/writer.py)

**Test:** `tests/test_writer.py`

- [ ] **5-1. 실패 테스트**: `BatchWriter(db_path)` — `trace_start(row)`/`span_finish(row)`/`trace_end(id, fields)` 호출 → `flush()` 후 DB에 반영. 스레드 여러 개가 동시에 넣어도 유실 없음. `close()`는 잔여분 flush. runtime call_edges upsert(count 증가) 포함
- [ ] **5-2. 구현**: `queue.SimpleQueue`에 (kind, row) 튜플 적재, 데몬 스레드가 250ms마다 또는 500건 도달 시 한 트랜잭션으로 반영. `atexit.register(close)`. writer 내부 예외는 잡아서 추적 비활성화 플래그만 세움(앱 보호). **Writer는 인터페이스(start/finish/end/close)로 분리** — PRD의 "병목 시 HTTP 전송 writer로 교체" 대비
- [ ] **5-3.** PASS → 커밋 `M1: 배치 writer`

### Task 6: 프로젝트 코드 필터 (tracer/filter.py)

**Test:** `tests/test_filter.py`

- [ ] **6-1. 실패 테스트**: 프로젝트 루트 아래 파일 → True. site-packages/dist-packages/표준 라이브러리(`sys.prefix`, `sys.base_prefix` 하위)/`<frozen ...>`/`<string>` → False. `.venv` 등 루트 안의 가상환경도 False. flowlens 자기 자신 False
- [ ] **6-2. 구현**: `CodeFilter(project_root)` — `should_trace(filename) -> bool`, 결과 캐시(dict)
- [ ] **6-3.** PASS → 커밋 `M1: 프로젝트 코드 필터`

### Task 7: TraceSession + settrace 백엔드 (전 버전 동작)

**Files:** `tracer/core.py`, `tracer/backend_settrace.py` · **Test:** `tests/test_tracer.py`

- [ ] **7-1. 실패 테스트** (동기 시나리오):

```python
def test_call_tree_recorded(tmp_path):
    """개요: 중첩 함수 호출이 부모-자식 관계로 기록되는지 검증한다."""
    # session 시작 → outer()가 inner()를 2번 호출 → session 종료
    # 검증: spans 3개, inner 스팬들의 parent_id == outer 스팬 id,
    #        args_json에 인자 반영, return_json에 리턴값, seq 순서 보존

def test_exception_recorded(...):   # raise한 함수 스팬 status=error, error_json에 type/message
def test_untraced_code_excluded(...): # json.dumps 등 라이브러리 호출은 스팬 없음
def test_thread_calls_recorded(...):  # threading.Thread 안의 호출도 기록(parent 없으면 루트 직속)
```

- [ ] **7-2. core.py 구현**:

```python
class TraceSession:
    """개요: 실행 1건(트레이스)의 스팬들을 조립해 writer로 보낸다.
    로직: 백엔드가 알려주는 call/return/exception 이벤트를 frame→span 맵으로 부모를 찾아 스팬으로 만든다."""
    # on_call(frame) -> frame_map[id(frame)] = (span_id, started_at, args_json)
    #   parent: frame.f_back을 따라가며 frame_map에 있는 첫 조상
    # on_return(frame, retval) -> span_finish(...) + frame_map.pop
    # on_exception(frame, exc) -> 해당 스팬 status='error'
    # seq: itertools.count. 트레이스 시작/종료 시 writer.trace_start/trace_end
```

- [ ] **7-3. backend_settrace.py 구현**: 전역 콜백에서 `filter.should_trace(frame.f_code.co_filename)` 검사, call → session.on_call + 로컬 트레이스 함수 반환, return/exception 이벤트 전달. `threading.settrace`도 설치. **콜백 전체 try/except — 내부 오류 시 sys.settrace(None)으로 자기 해제(fail-open)**
- [ ] **7-4.** PASS → 커밋 `M1: TraceSession + settrace 백엔드`

### Task 8: sys.monitoring 백엔드 (3.12+)

**Files:** `tracer/backend_monitoring.py`, `tracer/__init__.py`(백엔드 자동 선택) · **Test:** Task 7 테스트를 두 백엔드로 파라미터라이즈

- [ ] **8-1.** `pytest.fixture(params=["settrace", "monitoring"])`로 기존 테스트 재사용 (3.12 미만이면 monitoring skip)
- [ ] **8-2. 구현**: `sys.monitoring.use_tool_id(5, "flowlens")`, PY_START/PY_RETURN/PY_UNWIND 등록. PY_START 콜백에서 `sys._getframe(1)`로 대상 frame 획득, 비프로젝트 코드는 `sys.monitoring.DISABLE` 반환(코드객체 단위 영구 차단 → 저오버헤드). `select_backend()`: 3.12+ → monitoring, 아니면 settrace
- [ ] **8-3.** PASS → 커밋 `M1: sys.monitoring 백엔드 + 자동 선택`

### Task 9: 프로세스 트레이스 통합 (bootstrap.py)

**Test:** `tests/test_bootstrap.py` (subprocess 통합 테스트)

- [ ] **9-1. 실패 테스트**: 환경변수(`FLOWLENS_ENABLED=1, FLOWLENS_DB, FLOWLENS_PROJECT_ROOT`) 세팅 후 `python -c "import flowlens.bootstrap; flowlens.bootstrap.install(); import demo_script"` 실행 → DB에 entry_kind='process' 트레이스 1개 + demo_script의 함수 스팬들 존재, 프로세스 정상 종료 시 trace status='ok'
- [ ] **9-2. 구현**: env 읽기 → writer/filter/session 구성 → 백엔드 설치 → atexit에 trace_end+close 등록. env 없거나 오류면 **조용히 no-op**
- [ ] **9-3.** PASS → 커밋 `M1: bootstrap(환경변수 기반 설치)`

### Task 10: FastAPI/Starlette 요청 그룹핑 (tracer/asgi.py)

**Test:** `tests/test_asgi.py`

- [ ] **10-1. 실패 테스트**: 추적기 설치 상태에서 Starlette 앱을 ASGI로 직접 호출(요청 2번) → 트레이스 2개(entry_kind='http', entry_name='GET /orders', http_status 반영), 각 트레이스에 핸들러 함수 스팬 포함. starlette 미설치 환경이면 skip
- [ ] **10-2. 구현**: bootstrap 시 starlette가 import되면 `Starlette.__call__`(FastAPI 부모)을 패치 — scope type=='http'일 때 요청마다 TraceSession 생성/종료(contextvar로 현재 세션 관리, 프로세스 기본 트레이스는 http 요청 중 일시 중단). 패치 실패 시 경고 없이 프로세스 트레이스 모드 유지(fail-open). x-flowlens-trace 헤더가 있으면 traces.client_trace_id에 저장(M4 대비)
- [ ] **10-3.** PASS → 커밋 `M1: ASGI 요청 단위 트레이스 그룹핑`

### Task 11: `flowlens run` CLI (run.py, cli.py, paths.py)

**Test:** `tests/test_run_cli.py`

- [ ] **11-1. 실패 테스트**: `flowlens run python demo.py`를 subprocess로 실행 → (a) 자식이 정상 실행되고 종료코드 전파 (b) `.flowlens/data.db` 생성 + 트레이스 기록 (c) `flowlens run` 없이 `python demo.py`만 실행하면 DB 미생성(오버헤드 0 확인)
- [ ] **11-2. 구현**:

```python
def run_command(argv: list[str]) -> int:
    """개요: 사용자 명령을 추적기가 붙은 상태로 실행한다.
    로직: sitecustomize.py가 든 임시 폴더를 PYTHONPATH 맨 앞에 넣고 환경변수를 세팅해 자식 프로세스를 실행한다.
    참고: 코드 수정 0 원칙의 구현 지점. 자식의 종료코드를 그대로 반환한다."""
    # sitecustomize.py 내용: "import flowlens.bootstrap as b; b.install()" (try/except 감싸기)
    # env: FLOWLENS_ENABLED=1, FLOWLENS_DB=<root>/.flowlens/data.db, FLOWLENS_PROJECT_ROOT=<root>
    # paths.find_project_root(): cwd에서 위로 올라가며 pyproject.toml/.git/package.json 탐색, 없으면 cwd
```

- [ ] **11-3.** PASS → 커밋 `M1: flowlens run CLI`

### Task 12: FastAPI 데모 앱 (examples/fastapi-demo)

**Files:** `examples/fastapi-demo/main.py`, `app/service.py`, `app/models.py`, `app/repo.py`, `requirements.txt`, `traffic.sh`

- [ ] **12-1.** 재고/주문 도메인 데모 작성 — 엔드포인트 3개(`POST /orders`, `GET /orders/{id}`, `GET /inventory`), service→repo 2단 호출 구조, Pydantic 엔티티(Order, Stock), 일부러 에러 나는 엔드포인트 1개(`POST /orders`에 재고 부족 시 예외). **모든 함수/클래스에 PRD 6절 주석 룰 적용(개요/로직/참고, 파라미터)** — M2 파서 검증의 살아있는 픽스처가 된다
- [ ] **12-2.** `flowlens run uvicorn main:app` + `traffic.sh`(curl 몇 발) 수동 실행 → `sqlite3 .flowlens/data.db 'SELECT entry_name, status FROM traces'`로 http 트레이스 확인
- [ ] **12-3.** 커밋 `M1: FastAPI 데모 앱`

### Task 13: UI 서버 API (packages/ui — Fastify)

**Files:** `packages/ui/package.json`, `tsconfig.json`, `src/server/{index,api,db}.ts` · **Test:** `tests/api.test.ts` (vitest)

- [ ] **13-1. 실패 테스트**: 픽스처 DB(테스트에서 스키마+가짜 트레이스 2개 생성) 대상 —
  - `GET /api/traces` → 최신순, `span_count`/`duration_ms` 포함, `?q=`로 entry_name 부분검색
  - `GET /api/traces/:id` → trace + spans(seq 순) + functions 조인으로 `doc_overview` 포함(M2 전이라 NULL 허용)
  - `GET /api/health` → `{ok: true, db: <path>}`
- [ ] **13-2. 구현**: better-sqlite3 readonly 연결, Fastify 라우트. 서버 옵션: `--db`(기본 `./.flowlens/data.db`), `--port`(기본 7411)
- [ ] **13-3.** PASS → 커밋 `M1: UI 서버 API(트레이스 목록/상세)`

### Task 14: React 화면 — 트레이스 목록

**Files:** `packages/ui/src/web/` (Vite React TS 앱: `main.tsx`, `App.tsx`, `pages/TraceList.tsx`, `api.ts`)

- [ ] **14-1.** Vite 앱 뼈대 + react-router (`/` 목록, `/traces/:id` 상세). **화면 작업 시작 전 dataviz 스킬 로드**(시간 바/상태 색상 규칙 준수)
- [ ] **14-2.** 목록 페이지: 테이블(시각, 진입점, 소요시간, 스팬 수, 상태 배지), 2초 폴링, 검색창(`?q=`), 행 클릭 → 상세 이동. 로딩/빈 상태("아직 기록이 없어요 — flowlens run으로 앱을 실행하세요") 처리
- [ ] **14-3.** dev 프록시(`/api` → 7411)로 데모 데이터 눈 확인 → 커밋 `M1: 트레이스 목록 화면`

### Task 15: React 화면 — 트레이스 상세(호출 트리)

**Files:** `pages/TraceDetail.tsx`, `components/SpanTree.tsx`, `components/SpanPanel.tsx`

- [ ] **15-1.** `buildTree(spans)` 유틸 + vitest: parent_id 기반 트리 조립, seq 정렬, 고아 스팬(parent 유실)은 루트로 (**실패 테스트 먼저**)
- [ ] **15-2.** 트리 뷰: 들여쓰기 + 접기/펼치기 + 함수명 + 소요시간 바(트레이스 전체 대비 비율) + 에러 스팬 강조. 노드 클릭 → 우측 패널: 주석(개요/로직/참고 — M2 전이면 "주석 없음"), 파라미터/리턴값 JSON 펼침 뷰, 에러 스택
- [ ] **15-3.** 데모 데이터로 눈 확인 → 커밋 `M1: 트레이스 상세(호출 트리) 화면`

### Task 16: UI 패키징 (npx 실행)

**Files:** `src/server/cli.ts`, package.json `bin` 필드, 빌드 스크립트

- [ ] **16-1.** `npm run build` = Vite 빌드(web → dist/web) + 서버 tsc(→ dist/server). 서버가 dist/web 정적 서빙 + SPA fallback
- [ ] **16-2.** `package.json`: `"bin": {"flowlens-ui": "dist/server/cli.js"}` — `node dist/server/cli.js --db ... --port ...`로 기동 확인, 브라우저 접속 확인
- [ ] **16-3.** 커밋 `M1: UI 패키징(npx flowlens-ui)`

### Task 17: M1 E2E 검증 (완료 기준 확인)

- [ ] **17-1.** 순서대로: 데모 앱을 `flowlens run uvicorn main:app --port 8000`으로 기동 → `traffic.sh` → `flowlens-ui` 기동 → `/api/traces`에 http 트레이스·에러 트레이스 존재, `/api/traces/:id`에 service→repo 호출 트리와 args/return 값 확인 (curl + 브라우저 스크린샷)
- [ ] **17-2.** 발견된 문제 수정(각각 실패 테스트 추가 후 수정) → 커밋
- [ ] **17-3.** README.md(저장소 루트): 설치~실행 빠른 시작 작성 → 커밋 `M1: E2E 검증 완료 + 빠른 시작 문서`
- [ ] **17-4.** Task #1(할일 목록) 완료 처리, M2 계획 작성으로 이동

---

## Self-Review 체크 결과

- **PRD 커버리지**: M1 완료 기준(데모 앱 → UI 호출 트리·파라미터) = Task 17. 스키마는 M2~M5 테이블까지 선반영(Task 1)해 이후 마일스톤에서 스키마 변경 최소화. fail-open 원칙 = Task 4/5/7/9/11에 반영. "추적 안 켜면 오버헤드 0" = Task 11-1(c) 검증.
- **타입/이름 일관성**: function_id 형식, writer 인터페이스(start/finish/end/close), 환경변수 이름(FLOWLENS_*) 전 태스크 통일 확인.
- **플레이스홀더 없음** 확인.
