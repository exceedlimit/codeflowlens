# PRD — CodeFlowLens (코드네임, 변경 가능)

> 바이브코딩으로 만든 시스템의 실행 흐름·메서드·엔티티를 사람이 이해할 수 있게 해주는 모니터링 패키지.
> 작성일: 2026-08-04 · 원본 요건: [요건.md](요건.md)

---

## 1. 배경과 문제

LLM(바이브코딩)으로 개발한 시스템은:

- 어떤 동작이 어떤 로직/흐름으로 진행되는지 파악이 어렵다.
- 어떤 기능·메서드가 생성되었는지 확인이 어렵다.
- 파라미터·엔티티가 어떻게 전달되는지 보이지 않는다.

**CodeFlowLens는 이 문제를 세 가지 기능으로 해결한다:**

1. **룰 셋팅** — LLM이 개발할 때 항상 "비즈니스 관점 설명 주석"을 달도록 룰을 프로젝트에 심는다. 기존 코드에는 코딩 에이전트를 통해 소급 적용한다.
2. **자동 추적** — 앱이 실행될 때 함수 호출 흐름·파라미터·리턴값을 **코드 수정 0으로** 기록한다.
3. **시각화 UI** — 실행 흐름, 메서드 관계도, 엔티티 관계도를 로컬 웹 UI로 보여주고, 메서드를 클릭하면 비즈니스 주석을 보여준다.

## 2. 목표 / 비-목표

### 목표 (v1)

| # | 목표 |
|---|---|
| G1 | Python(3.9+)과 TypeScript(Node 20+ 백엔드, React 프론트) 프로젝트 지원 |
| G2 | 코드 오염 0: 사용자 코드에 추적용 코드를 남기지 않는다 (log4j/AOP처럼 붙기만 하면 동작) |
| G3 | 추가 인프라 설치 0: SQLite 파일 하나만 사용 |
| G4 | 실행 흐름(함수 호출 트리 + 파라미터/리턴값 전체) 시각화 |
| G5 | 메서드 관계도·엔티티 관계도 (정적 분석 + 실행 기록 결합) |
| G6 | 비즈니스 주석 룰 셋팅 + 기존 코드 소급(코딩 에이전트 활용) + 준수 검사기 |
| G7 | 프론트엔드(브라우저)의 API 호출을 백엔드 트레이스와 연결 |

### 비-목표 (v1에서 하지 않는 것)

- 운영(production) 환경 상시 모니터링 — 추적은 개발자가 명시적으로 켤 때만 동작
- 브라우저 코드의 함수 단위 추적 (v2 — v1은 API 호출 단위까지)
- SpringBoot/Java 지원 (v2 — 단, 스키마·UI는 언어 중립으로 설계해 확장 가능하게)
- 팀 공유용 중앙 서버 / GraphDB (필요해지면 전환 경로만 열어둠)
- LLM API 직접 호출 (주석 작성은 사용자의 코딩 에이전트가 수행)

## 3. 확정된 결정사항

| 항목 | 결정 | 비고 |
|---|---|---|
| 지원 언어 | Python + TypeScript 동시 | TS는 React 프론트 + Node 백엔드 포함 |
| 설치 단위 | 기본은 전체 설치, 언어별 선택 설치 가능 | `init` 시 자동 감지 + `--lang` 옵션 |
| 저장소 | SQLite (WAL 모드) | 프로젝트 내 `.codeflowlens/data.db` 파일 하나 |
| UI | 로컬 웹 UI (`npx`로 실행, localhost) | langfuse/Jaeger와 같은 방식 |
| 추적 방식 | 언어 내장 훅 (A안) | Python: `sys.monitoring`/`settrace` · Node: module hooks |
| 추적 활성화 | 명시적으로 켤 때만 (`codeflowlens run ...`) | 운영 배포에서 실수로 켜질 위험 차단, 꺼져 있으면 오버헤드 0 |
| 프론트 추적 깊이 | v1은 API 호출 단위 | 함수 단위는 v2 |
| 관계도 소스 | 정적 분석 + 실행 기록 결합 | 실행 안 된 코드도 지도에 표시, 실제 흐름은 겹쳐 표시 |
| 값 저장 | 파라미터/리턴값 전체 저장 | 값 1개당 크기 상한만 둠(기본 64KB, 설정 가능) |
| 주석 소급 | 코딩 에이전트 활용 | AGENTS.md·룰파일·작업지시서·skill 생성 |
| 데이터 보존 | 기본 1주일, UI 설정 화면에서 변경 | 실행 기록만 정리, 코드맵은 유지 |

## 4. 사용자 시나리오

### 시나리오 1 — 새 프로젝트에 설치

```bash
# Python 백엔드 프로젝트에서
pip install codeflowlens
codeflowlens init            # 언어 자동 감지, --lang python,node,browser 로 선택 가능
```

`init`이 하는 일:
1. `.codeflowlens/` 폴더 + 설정 파일(`config.toml`) 생성
2. `AGENTS.md`에 주석 룰 섹션 추가 (없으면 생성, 있으면 마커 블록으로 삽입) — 이후 LLM이 개발할 때 자동으로 룰 준수
3. `CLAUDE.md`가 있으면 AGENTS.md 참조 라인 추가 (Claude Code 호환)
4. 코딩 에이전트용 소급 작업 skill(`.claude/skills/codeflowlens-retrofit/`) + 작업지시서 생성
5. 첫 정적 분석 실행 → 코드맵 생성
6. `.gitignore`에 `.codeflowlens/data.db` 추가

### 시나리오 2 — 기존 코드에 주석 소급

```bash
codeflowlens check           # 룰에 안 맞는 함수/클래스 목록 출력
# → 사용자가 코딩 에이전트에게 "codeflowlens-retrofit skill로 소급 작업해줘"
# → 에이전트가 주석 작성 후 codeflowlens check로 스스로 검증
```

### 시나리오 3 — 실행하고 모니터링

```bash
codeflowlens run uvicorn main:app     # 감싸서 실행하면 추적 ON
codeflowlens run npm run dev          # Node도 동일
codeflowlens ui                       # UI 서버 실행 → 브라우저에서 localhost:7411
```

- 모든 명령은 축약형 `cfl`로도 쓸 수 있다 (`cfl run ...`, `cfl ui`).
- `ui`는 프로젝트에 설치된 `@codeflowlens/ui` → PATH의 `codeflowlens-ui` → `npx -y @codeflowlens/ui` 순으로 찾아 실행하고, 기본 DB로 프로젝트의 `.codeflowlens/data.db`를 넘긴다. UI만 따로 띄울 땐 `npx @codeflowlens/ui`도 그대로 쓸 수 있다.

UI에서: 요청별 실행 흐름(호출 트리) → 함수 클릭 → 개요/로직/참고 주석 + 파라미터/리턴값 확인. 메서드 관계도·엔티티 관계도 탐색.

## 5. 아키텍처

```
┌─────────────── 사용자의 프로젝트 ────────────────┐
│                                                   │
│  React 프론트 ──(API 호출 기록을 HTTP로 전송)───┐  │
│  Python 백엔드 ─┐                               │  │
│  Node 백엔드  ──┤ (함수 호출을 SQLite에 기록)   │  │
└─────────────────┼──────────────────────────────┼──┘
                  ▼                              ▼
          ┌──────────────┐             ┌───────────────┐
          │ SQLite 파일   │◀────────── │ UI 서버        │
          │ .codeflowlens/    │  읽기/쓰기  │ (수집+화면)    │
          │ data.db       │             │ localhost:7411 │
          └──────────────┘             └───────────────┘
```

### 배포 패키지 3개

| 패키지 | 배포 | 역할 |
|---|---|---|
| `codeflowlens` | PyPI | Python 추적기 + Python 정적 분석기 + CLI(init/run/check/scan) |
| `@codeflowlens/node` | npm | Node 추적기 + TS 정적 분석기 + 브라우저 기록 스크립트 + Vite 플러그인 + CLI |
| `@codeflowlens/ui` | npm | UI 서버(화면 + 브라우저 이벤트 수집 창구) + 데이터 정리 스케줄러 |

- 사용자는 프로젝트에 있는 언어의 패키지만 설치하면 된다. (Python만 → `codeflowlens`, 풀스택 → 셋 다)
- 모든 패키지는 **동일한 SQLite 스키마**로 읽고 쓴다. UI는 언어를 모른다. → SpringBoot 확장 시 Java 추적기만 추가하면 됨.
- v1의 UI 서버는 Node 하나로 통일 (v1 타겟이 Python+TS 풀스택이므로 Node 존재 가정. 순수 Python 사용자도 Node만 있으면 `npx`로 즉시 실행 가능).

### 핵심 개념 (데이터 모델)

| 개념 | 정의 |
|---|---|
| **Trace** | 하나의 실행 묶음. 웹 요청 1건 = 1 트레이스, 스크립트 실행 1번 = 1 트레이스 |
| **Span** | 트레이스 안의 함수 호출 1건. 부모-자식 관계로 저장 → 호출 트리. 파라미터/리턴값/예외/시간 포함 |
| **CodeMap** | 정적 분석 결과: 함수/클래스 목록, 파싱된 비즈니스 주석, 호출 가능 관계(A→B), 파일 위치 |
| **Entity** | 데이터 모델 클래스. Python: Pydantic/SQLAlchemy/dataclass · TS: interface/type/class/Prisma 모델 |
| **EntityUsage** | 어떤 함수가 어떤 엔티티를 파라미터/리턴으로 쓰는지 (정적 분석으로 추출) |

Span과 CodeMap의 함수는 **함수 ID(파일경로 + 클래스명 + 함수명)**로 연결된다. → "정적 지도 위에 실제 실행을 겹쳐 보기"가 가능한 이유.

### SQLite 스키마 (요약)

```
traces(id, started_at, ended_at, status, entry_kind, entry_name, http_method, http_path, source, client_trace_id)
spans(id, trace_id, parent_id, function_id, started_at, ended_at, status, args_json, return_json, error_json, seq)
functions(id, language, file_path, qualified_name, line, doc_overview, doc_logic, doc_note, is_entity_method)
call_edges(caller_id, callee_id, kind)            -- kind: static | runtime
entities(id, language, file_path, name, doc_overview, doc_note)
entity_fields(entity_id, name, type, description)
entity_relations(from_id, to_id, kind)            -- 필드 타입 참조로 추출
entity_usages(entity_id, function_id, role)       -- role: param | return
client_events(id, trace_id, page_url, action, ts) -- 브라우저에서 온 API 호출 기록
settings(key, value)                              -- retention_days 기본 7 등
schema_version(version)
```

- WAL 모드 + `busy_timeout` + 배치 기록(추적기가 모아서 트랜잭션 단위로 flush)으로 다중 프로세스 동시 접근 처리.
- **병목 대비책**: 기록 모듈(writer)을 인터페이스로 분리해둔다. SQLite 직접 쓰기가 병목이 되면 "UI 서버로 HTTP 전송 → 서버 단일 작성자" 방식으로 교체 가능하게. (브라우저는 v1부터 이 방식 사용)

## 6. 주석 룰 (확정 형식)

파서가 라벨을 인식해 구조화 저장하고 UI에 표시한다. 라벨은 한국어 기본, 영어 별칭 허용(`Overview/Logic/Note/Fields`).

### 메서드/함수 — `개요`(필수) · `로직`(필수) · `참고`(선택)

```python
def add_stock(item_id: str, qty: int) -> Stock:
    """
    개요: 재고 수량을 추가한다.
    로직: 현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다.
    참고: 재고는 음수가 될 수 없다.
    """
```

```typescript
/**
 * 개요: 재고 수량을 추가한다.
 * 로직: 현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다.
 * 참고: 재고는 음수가 될 수 없다.
 */
function addStock(itemId: string, qty: number): Stock {
```

### 클래스(엔티티) — `개요`(필수) · `파라미터`(필수) · `참고`(선택)

```python
class Order(BaseModel):
    """
    개요: 고객의 주문 정보를 담는 엔티티.
    파라미터:
      - order_id: 주문 번호
      - quantity: 주문 수량
    참고: 취소된 주문은 quantity가 0이 된다.
    """
    order_id: str
    quantity: int
```

### 작성 원칙 (AGENTS.md에 삽입되는 룰의 핵심)

- 코드 구조·문법 설명 금지, **비즈니스 관점**으로 작성.
  - BAD: "plus_count를 호출합니다."
  - GOOD: "재고 수량을 추가합니다."
- 새 함수/클래스를 만들면 즉시 주석 작성. 로직 변경 시 주석도 현행화.
- private 헬퍼(이름이 `_`로 시작 등)와 테스트 코드는 `개요`만으로 충분(완화 룰).
- `codeflowlens check`가 준수 여부를 기계적으로 검사한다 (누락/형식 오류 목록 출력, CI 연동 가능).

## 7. 추적 동작 상세

### Python 추적기 (`codeflowlens`)

- `codeflowlens run <명령>` → 자식 프로세스에 환경변수 + `sitecustomize` 주입으로 추적기 탑재 → 코드 수정 0.
- Python 3.12+: `sys.monitoring`(저오버헤드 공식 API) / 3.9~3.11: `sys.settrace` 폴백.
- **프로젝트 코드만 추적** (site-packages·표준 라이브러리 제외, 설정으로 조정 가능).
- 요청 단위 트레이스 묶기: ASGI(Starlette/FastAPI) 진입점을 감지해 요청 1건 = 트레이스 1건으로 그룹핑. 웹 앱이 아니면 프로세스 실행 1번 = 1 트레이스.
  - 현재 한계: WSGI(Flask/Django runserver)는 요청별 묶기 미구현 — 호출·값은 기록되지만 프로세스 트레이스 1건으로 남는다. (v2 후보)
- async: `contextvars`로 코루틴 간 트레이스 컨텍스트 유지. 멀티프로세스(uvicorn workers): 프로세스별 추적기가 같은 DB에 배치 기록.
- 값 직렬화: JSON 우선, 실패 시 `repr()` 문자열. 값 1개당 상한 초과분은 잘라내고 표시(`…truncated`).

### Node 추적기 (`@codeflowlens/node`)

- `codeflowlens run <명령>` → `NODE_OPTIONS=--import @codeflowlens/node/register` 주입.
- module hooks(Node 20+)로 **로드 시점에 메모리에서만** 함수 진입/이탈 계측 코드를 삽입 (istanbul 방식). 디스크 원본 불변. ESM/CJS, TS(tsx·ts-node·빌드된 JS) 지원.
- `node_modules` 제외, 프로젝트 코드만. `AsyncLocalStorage`로 async 흐름 유지.
- http 서버 요청 감지로 요청 1건 = 1 트레이스 (Express/Nest/Fastify/Next API 등 http 모듈 레벨에서 공통 처리).
- **외부 이벤트 진입점**(http를 거치지 않는 호출 — 슬랙 봇 웹소켓 수신, 타이머·큐 콜백 등):
  이미 끝난 함수의 컨텍스트에서 시작된 루트 호출을 이벤트로 감지해
  **이벤트 1건 = 트레이스 1건**(`entry_kind='event'`, 진입점 이름 = 함수 이름)으로 승격한다.
  서버 기동 흐름은 기존대로 프로세스 트레이스에 남는다. 이벤트 진입점도
  설정의 "추적 제외" 목록으로 끌 수 있다. (모듈 최상위에서 직접 등록한 콜백처럼
  함수 컨텍스트가 전혀 없는 경우는 기존대로 프로세스 트레이스에 담긴다 — 알려진 한계)

### 브라우저 기록 (v1: API 호출 단위)

- Vite 플러그인 1줄(`codeflowlensDev()`)을 개발 설정에 추가하면, **개발 모드에서만** 소형 스크립트가 자동 주입됨.
- 스크립트는 `fetch`/`XHR`을 감싸 API 호출을 기록하고 `x-codeflowlens-trace` 헤더를 붙임 → 백엔드 추적기가 이 헤더를 읽어 **"화면의 이 동작 → 백엔드의 이 흐름"으로 연결**.
- 기록(페이지 URL, 호출 시각, 소요시간)은 UI 서버의 수집 엔드포인트로 전송. UI 서버가 꺼져 있으면 조용히 버림(앱에 영향 0).

### 안전 원칙 (모든 추적기 공통)

1. **추적기는 절대 사용자 앱을 죽이지 않는다** — 내부 오류 시 추적만 끄고 앱은 계속 (fail-open).
2. 기록은 백그라운드에서 배치로 flush — 사용자 코드 실행을 막지 않는다.
3. `codeflowlens run` 없이 실행하면(운영 환경) 아무것도 하지 않는다 — 오버헤드 0.
4. 프로세스 종료 시 잔여 버퍼 flush (atexit/beforeExit 훅).

## 8. 정적 분석 상세

- Python: 표준 `ast` 모듈. TS: TypeScript 컴파일러 API(ts-morph).
- 추출 대상: 함수/메서드 정의(위치·시그니처), 주석(라벨 파싱), 호출 관계(A 함수 본문에서 B 호출 — 같은 프로젝트 내 해석 가능한 것만), 엔티티 정의(Pydantic/SQLAlchemy/dataclass/interface/type/Prisma), 엔티티 필드와 타입 참조(→ 엔티티 관계), 함수 시그니처의 엔티티 사용(param/return).
- 실행 시점: `codeflowlens init`(첫 스캔 포함), `codeflowlens scan`(수동 갱신), **UI 서버가 소스 파일 변경을 감지하면 자동 재스캔**(디바운스 1.5초, 전체 재스캔 — 중형 프로젝트 수 초 이내라 증분 불필요). UI 상단에 갱신 시각 표시 + "지금 갱신" 버튼. 감지 끄기: `--no-watch`, 스캔 명령 수동 지정: `--scan-cmd`.
- 정적 분석의 한계(동적 호출, `getattr` 등으로 못 잡는 관계)는 실행 기록(runtime call_edges)이 보완한다 — 결합 설계의 이유.

## 9. UI 화면 (5개)

| 화면 | 내용 |
|---|---|
| **① 트레이스 목록** | 최근 실행/요청 리스트: 시각, 진입점(HTTP GET /orders 등), 소요시간, 성공/에러, 출처(프론트 페이지). 검색·필터 |
| **② 트레이스 상세** | 호출 트리(계층 + 소요시간 바). 노드 클릭 → 개요/로직/참고 주석 + 파라미터/리턴값(JSON 뷰어) + 에러 스택. 프론트 발 요청이면 어느 페이지의 어떤 동작에서 왔는지 표시 |
| **③ 메서드 관계도** | 정적 호출 그래프 + 실행 빈도 오버레이(자주 불린 간선 강조, 실행 안 된 노드 흐리게). 함수 검색, 클릭 → 주석·파일 위치·관련 트레이스 |
| **④ 엔티티** | 엔티티 목록/필드/주석, 엔티티 관계도, "이 엔티티를 쓰는 함수" 목록 → 해당 함수로 이동 |
| **⑤ 설정** | **데이터 보존 주기(기본 7일)** 변경, 값 크기 상한, 추적 제외 경로 관리. 저장은 settings 테이블 |

- 데이터 정리: UI 서버가 기동 시 + 매일 1회, 보존 주기 지난 트레이스/스팬/client_events 삭제 후 `VACUUM`(주기적). 코드맵·엔티티는 시간과 무관하므로 유지.
- 관계도가 큰 프로젝트 대응: 패키지/디렉토리 단위 접기, 검색 중심 탐색, 노드 수 상한 + "더 보기".

## 10. 기술 스택

| 구성요소 | 기술 | 이유 |
|---|---|---|
| Python 패키지 | 순수 Python(표준 `sys.monitoring`/`ast`/`sqlite3`), hatchling 빌드 | 외부 의존성 0 → 사용자 프로젝트와 충돌 없음 |
| Node 패키지 | TypeScript, Node module hooks, acorn(AST 계측), better-sqlite3, AsyncLocalStorage | 검증된 계측 방식, 빠른 동기 SQLite |
| UI 서버 | Node + Fastify, 정적 파일 서빙 + REST API + 수집 엔드포인트 | UI와 같은 생태계로 통일 |
| UI 프론트 | React + Vite + TypeScript, 관계도: React Flow, JSON 뷰어/가상 스크롤 | 표준적, 유지보수 쉬움 |
| 저장소 | SQLite WAL | 결정사항 |
| 테스트 | pytest / vitest + 데모 앱 E2E | 마일스톤마다 검증 |

## 11. 검증 계획

1. **단위 테스트**: 추적기(호출 트리 정확성, async, 예외, 값 직렬화), 주석 파서, 정적 분석기(스냅샷 테스트), 정리 스케줄러.
2. **데모 앱**: `examples/`에 FastAPI+React, Express 데모를 두고 E2E 검증(추적 → DB → UI API 응답까지).
3. **실전 검증**: 아래 실제 프로젝트에 설치해 전 기능 검증.
   - 실전 프로젝트 A — Python 대형 백엔드
   - 실전 프로젝트 B — TypeScript 프로젝트
4. 성능 기준: 추적 ON 시 데모 앱 응답시간 오버헤드 30% 이내(개발 환경 기준), 추적 OFF 시 0.

## 12. 로드맵 (v1 전체 완료 — 2026-08-04)

| 마일스톤 | 내용 | 완료 기준 | 상태 |
|---|---|---|---|
| **M1** | 공통 스키마 + Python 추적기 + 최소 UI(트레이스 목록/상세) | 데모 FastAPI 앱을 `codeflowlens run`으로 실행 → UI에서 호출 트리·파라미터 확인 | ✅ |
| **M2** | Python 정적 분석 + init/check + 주석 룰 + 관계도 UI | init으로 룰 셋팅, check 동작, 메서드/엔티티 관계도 표시 | ✅ |
| **M3** | Node 추적기 + TS 정적 분석 | Express 데모에서 M1·M2와 동일 수준 동작 | ✅ |
| **M4** | 브라우저 API 기록 + 프론트↔백 연결 | React 데모에서 버튼 클릭 → 백엔드 흐름까지 한 트레이스로 표시 | ✅ |
| **M5** | 엔티티 관계도 고도화 + 설정 화면(보존 주기) + 커버리지 대시보드 + 실전 프로젝트 검증 | 실전 프로젝트 A / 실전 프로젝트 B에서 전 기능 동작 | ✅ |

실전 검증 결과: 실전 프로젝트 A(Python, 함수 2,983개·엔티티 179개)와 실전 프로젝트 B(TS, 함수 472개·엔티티 106개)에서 scan/check/UI 전 기능 동작 확인. 테스트 총 136개(pytest 62 + Node vitest 45 + UI vitest 29).

## 13. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| Node 메모리 계측의 소스맵/변환 꼬임 (tsx, Next 등 도구별 차이) | M3에서 도구별 매트릭스 테스트, 문제 도구는 문서화된 폴백(빌드된 JS 추적) 제공 |
| 전체 값 저장으로 인한 용량 증가 | 값 1개 64KB 상한 + 보존 주기 정리 + 설정 화면에서 조정 |
| SQLite 다중 프로세스 쓰기 경합 | WAL + busy_timeout + 배치. 병목 시 writer 교체(단일 작성자 서버) 경로 확보 |
| 대형 프로젝트에서 관계도 렌더링 성능 | 접기/검색/노드 상한. React Flow 가상화 |
| `settrace`(구버전 Python) 오버헤드 | 3.12+ 권장 명시, 구버전은 기능 동일하되 느릴 수 있음을 문서화 |
| 주석 룰 미준수 (에이전트가 안 지킴) | AGENTS.md 룰 + check 검사기 + retrofit skill 3중 장치 |

## 14. 미결/후속 (v2 후보)

- 제품명 확정 (현 코드네임 CodeFlowLens)
- 브라우저 함수 단위 추적 (번들러 플러그인 계측)
- SpringBoot/Java 추적기
- 팀 공유 모드 (PostgreSQL 전환, 인증)
- GraphDB 연동 (관계 탐색이 SQLite 한계에 닿을 경우)
- 트레이스 diff ("이 기능이 어제와 다르게 동작한 이유")
