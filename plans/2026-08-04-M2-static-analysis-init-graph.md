# M2 구현 계획 — Python 정적 분석 + init/check + 관계도 UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `flowlens init`으로 주석 룰이 프로젝트에 심어지고(AGENTS.md·retrofit skill), `flowlens scan`이 코드를 읽어 함수/주석/호출관계/엔티티를 DB에 채우고, `flowlens check`가 룰 준수를 검사하며, UI에서 메서드 관계도와 엔티티 화면을 볼 수 있다.

**Architecture:** (PRD 6·8절) 표준 `ast` 모듈로 함수/클래스/호출/엔티티를 추출하고, 주석 파서가 라벨(개요/로직/참고/파라미터, 영문 별칭 Overview/Logic/Note/Fields)을 구조화한다. 결과는 functions/call_edges(kind=static)/entities/entity_* 테이블에 저장(스캔마다 정적 데이터 전체 교체). UI는 React Flow로 관계도를 그리고 실행 빈도(kind=runtime의 count)를 겹친다.

**Tech Stack:** Python 표준 ast/tomllib(3.9는 자체 미니 파서 대신 key=value 라인 파싱), React Flow(@xyflow/react), 기존 스택 유지

**완료 기준 (PRD 12절 M2):** init으로 룰 셋팅, check 동작, 메서드/엔티티 관계도 표시

---

## 설계 확정 사항

- **주석 파서 규칙**: docstring 줄들을 스캔해 `개요:`/`로직:`/`참고:`/`파라미터:`(또는 `Overview:`/`Logic:`/`Note:`/`Fields:`) 라벨을 찾는다. 라벨 없는 첫 줄은 `개요`로 간주(관대한 파싱 — 기존 한 줄 docstring도 수용). `파라미터:` 아래의 `- 이름: 설명` 목록은 엔티티 필드 설명으로 저장. 라벨 뒤 여러 줄은 다음 라벨 전까지 이어 붙인다.
- **function_id**: 추적기와 동일 규칙 `<상대경로>::<qualname>` (예: `app/service.py::create_order`, 메서드는 `app/models.py::Order.cancel`)
- **엔티티 판정**: 클래스가 (a) Pydantic BaseModel/SQLAlchemy Base/dataclass 데코레이터 상속·사용 또는 (b) 필드형 클래스(어노테이션만 있는 클래스)이면 엔티티. 베이스 이름 문자열 매칭(`BaseModel`, `Base`, `dataclass` 등) — import 해석까지는 하지 않는다(YAGNI).
- **호출 관계(static)**: 함수 본문의 `Name()`/`self.x()`/`module.f()` 호출을 수집하고, 같은 스캔에서 발견된 함수 이름과 매칭되는 것만 edge로 저장(보수적 — 못 푸는 동적 호출은 runtime edge가 보완).
- **entity_usages**: 함수 시그니처의 타입 어노테이션(파라미터/리턴)에 등장하는 엔티티 이름 매칭.
- **스캔 저장 방식**: 트랜잭션 안에서 `DELETE FROM functions/call_edges(kind='static')/entities/entity_fields/entity_relations/entity_usages` 후 전체 재삽입 (증분보다 단순·정확, 중형 프로젝트 수 초 이내).
- **check 판정**: 함수 — `개요`+`로직` 필수(단, `_`로 시작·테스트 파일·`__init__` 등 더블언더는 `개요`만으로 통과). 엔티티 — `개요`+`파라미터`(필드 설명) 필수, `참고`는 항상 선택. 위반 목록 출력 후 위반 있으면 exit 1(CI 연동).
- **init 산출물**: `.flowlens/config.toml`(languages, exclude), AGENTS.md 마커 블록(`<!-- flowlens:rules:start/end -->`) 삽입, CLAUDE.md에 AGENTS.md 참조 라인(없을 때만), `.claude/skills/flowlens-retrofit/SKILL.md`, `.flowlens/RETROFIT.md`(작업지시서), `.gitignore`에 `.flowlens/` 추가, 첫 scan 실행. `--lang python,node,browser`로 선택(기본: 자동 감지 전체).
- **UI 관계도**: `/api/graph` — 노드(함수, 파일별 그룹) + 엣지(static/runtime, runtime은 count 포함). 노드 수 상한 300 + 검색 필터. 클릭 → 주석/위치/관련 트레이스 링크. 엔티티 화면: `/api/entities` 목록 + 상세(필드/관계/사용 함수).

## 파일 구조 (추가분)

```
packages/python/src/flowlens/
  analyzer/__init__.py
  analyzer/docparse.py        # 주석 라벨 파서 (함수/엔티티 공용)
  analyzer/pyscan.py          # ast 방문자: 함수/클래스/호출/엔티티 추출
  analyzer/store.py           # 스캔 결과를 DB에 저장(전체 교체)
  init_cmd.py                 # flowlens init
  check_cmd.py                # flowlens check
  scan_cmd.py                 # flowlens scan
  templates/agents_rules.md   # AGENTS.md에 삽입되는 룰 본문
  templates/retrofit_skill.md # .claude/skills/flowlens-retrofit/SKILL.md 본문
  templates/retrofit_guide.md # 작업지시서 본문
packages/ui/src/server/api.ts   # /api/graph, /api/entities[/:id], /api/functions 추가
packages/ui/src/web/pages/GraphPage.tsx    # 메서드 관계도 (React Flow)
packages/ui/src/web/pages/EntitiesPage.tsx # 엔티티 목록/상세
tests: test_docparse.py, test_pyscan.py, test_store.py, test_check.py, test_init.py
       (UI) tests/api-graph.test.ts
```

---

### Task 1: 주석 파서 (analyzer/docparse.py)

- [ ] **1-1. 실패 테스트** `tests/test_docparse.py` — 케이스: (a) 라벨 3종 파싱 (b) 라벨 없는 한 줄 docstring → 개요로 (c) 영문 별칭 (d) `파라미터:` 필드 목록 파싱(`- name: desc`) (e) 여러 줄 값 이어붙임 (f) docstring 없음 → 전부 None (g) 라벨 순서 뒤섞여도 동작
- [ ] **1-2. 구현** `parse_doc(docstring) -> ParsedDoc(overview, logic, note, fields: dict[str,str])`
- [ ] **1-3.** PASS → 커밋 `M2: 주석 라벨 파서`

### Task 2: ast 스캐너 (analyzer/pyscan.py)

- [ ] **2-1. 실패 테스트** `tests/test_pyscan.py` — 픽스처 소스(문자열)로: 함수/메서드 추출(qualname·라인·docstring), 중첩 함수 제외 여부(포함하되 qualname에 `<locals>` 경로), async 함수, 호출 수집(같은 파일 함수 매칭), Pydantic 엔티티 + 필드(타입·어노테이션), dataclass 엔티티, 엔티티 간 참조(필드 타입에 다른 엔티티), 시그니처의 entity usage(param/return), 문법 오류 파일 → 건너뛰고 계속
- [ ] **2-2. 구현** `scan_project(root, exclude) -> ScanResult(functions, entities, static_edges, usages, relations)` — 파일 walk(필터는 tracer/filter.py의 EXCLUDED_DIR_NAMES 재사용)
- [ ] **2-3.** PASS → 커밋 `M2: ast 정적 분석기`

### Task 3: 저장 계층 (analyzer/store.py) + scan CLI

- [ ] **3-1. 실패 테스트** `tests/test_store.py` — 스캔 결과 저장 후 테이블 채워짐, 재스캔 시 정적 데이터만 교체(traces/spans/runtime edges 보존), functions와 스팬 function_id 조인 일치(데모 픽스처)
- [ ] **3-2. 구현** + `flowlens scan` 서브커맨드(cli.py 연결, 결과 요약 출력: 함수 N, 엔티티 N, 주석 커버리지 %)
- [ ] **3-3.** PASS → examples/fastapi-demo에서 `flowlens scan` 수동 확인 → 커밋 `M2: 스캔 저장 + scan CLI`

### Task 4: check CLI

- [ ] **4-1. 실패 테스트** `tests/test_check.py` — 위반 목록(함수: 개요/로직 누락, 엔티티: 파라미터 설명 누락), `_`헬퍼·테스트 파일 완화 룰, 전부 준수 시 exit 0 + "통과" 출력, 위반 시 exit 1
- [ ] **4-2. 구현** `flowlens check` (스캔 후 판정, --json 옵션으로 에이전트 소비용 출력)
- [ ] **4-3.** PASS → 커밋 `M2: check(주석 룰 검사기)`

### Task 5: init CLI + 룰 템플릿

- [ ] **5-1. 실패 테스트** `tests/test_init.py` — tmp 프로젝트에: `.flowlens/config.toml` 생성, AGENTS.md 마커 블록 삽입(기존 내용 보존·재실행 시 블록 갱신), CLAUDE.md 참조 라인(없을 때만 추가), retrofit skill 파일 생성, .gitignore 갱신, 첫 스캔 실행됨, `--lang python`만 지정 시 config 반영
- [ ] **5-2. 템플릿 작성** — agents_rules.md: PRD 6절 룰(BAD/GOOD 예시, 형식, check 사용법, "새 함수 즉시 주석·로직 변경 시 현행화"), retrofit_skill.md: check --json으로 위반 목록 뽑아 배치 작업하는 절차, retrofit_guide.md: 사람/에이전트 공용 작업지시서
- [ ] **5-3. 구현** `flowlens init` (언어 감지: pyproject/requirements→python, package.json→node, vite/react 의존→browser)
- [ ] **5-4.** PASS → 데모에서 수동 확인 → 커밋 `M2: init(룰 셋팅 + retrofit skill)`

### Task 6: UI API 확장 (graph/entities/functions)

- [ ] **6-1. 실패 테스트** `tests/api-graph.test.ts` — `/api/graph`: 노드(함수 id·이름·파일·주석 유무)+엣지(static/runtime·count), `?q=` 필터, 300개 상한; `/api/entities`: 목록+필드; `/api/entities/:id`: 필드/관계/사용 함수; `/api/functions/:id`: 주석+관련 트레이스 최근 10건
- [ ] **6-2. 구현** → PASS → 커밋 `M2: 관계도/엔티티 API`

### Task 7: 관계도 화면 (GraphPage)

- [ ] **7-1.** `@xyflow/react` 설치, 레이아웃: 파일(디렉토리) 단위 그룹 + dagre 자동 배치(또는 계층 배치 유틸 직접 구현 — 의존 최소화 위해 간단한 레이어드 배치 구현)
- [ ] **7-2.** 노드: 함수명(+주석 있으면 개요 툴팁), 실행 빈도로 엣지 굵기(runtime count), 실행 안 된 노드는 흐리게. 검색창, 노드 클릭 → 사이드 패널(개요/로직/참고, 파일:라인, 관련 트레이스 링크)
- [ ] **7-3.** 데모 데이터로 눈 확인(스크린샷) → 커밋 `M2: 메서드 관계도 화면`

### Task 8: 엔티티 화면 (EntitiesPage)

- [ ] **8-1.** 목록(이름·개요·필드 수·사용 함수 수) + 상세(필드 테이블: 이름/타입/설명, 참고, 엔티티 관계 미니 그래프, 사용 함수 목록 → 관계도/트레이스 링크)
- [ ] **8-2.** 데모 데이터로 눈 확인 → 커밋 `M2: 엔티티 화면`

### Task 9: M2 E2E 검증

- [ ] **9-1.** 데모 프로젝트에서 전체 플로우: `flowlens init`(AGENTS.md 등 생성 확인) → `flowlens scan` → `flowlens check`(데모는 주석 완비라 통과) → 트래픽 → UI에서 상세의 주석 표시(M1의 "주석 없음"이 채워짐)·관계도·엔티티 화면 확인(스크린샷)
- [ ] **9-2.** 주석 일부 지운 픽스처로 check 실패 케이스 확인
- [ ] **9-3.** 발견 문제 수정 + README 갱신(init/scan/check 사용법) → 커밋 `M2: E2E 검증 완료`

---

## Self-Review: PRD 6절(주석 룰 형식·완화 룰), 8절(정적 분석 대상·한계 보완), 4절 시나리오 1·2(init/check/retrofit), 9절 화면 ③④ 커버 확인. function_id 규칙 추적기와 동일 명시. 플레이스홀더 없음.
