# CodeFlowLens

[![PyPI](https://img.shields.io/pypi/v/codeflowlens?label=PyPI%20codeflowlens)](https://pypi.org/project/codeflowlens/)
[![npm node](https://img.shields.io/npm/v/@codeflowlens/node?label=npm%20%40codeflowlens%2Fnode)](https://www.npmjs.com/package/@codeflowlens/node)
[![npm ui](https://img.shields.io/npm/v/@codeflowlens/ui?label=npm%20%40codeflowlens%2Fui)](https://www.npmjs.com/package/@codeflowlens/ui)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**바이브코딩으로 만든 시스템이 실제로 어떻게 돌아가는지 눈으로 보여주는 모니터링 도구입니다.**

코드를 한 줄도 고치지 않고 함수 호출 흐름·파라미터·리턴값을 기록하고, 메서드·엔티티 관계도와 함께 로컬 웹 화면으로 보여줍니다. LLM이 코드를 짤 때 **비즈니스 관점의 설명 주석**을 항상 달도록 룰도 심어 주기 때문에, 화면에서 함수를 누르면 "이 함수가 무슨 일을 하는지"가 사람의 말로 보입니다.

```bash
pip install codeflowlens      # 설치
cfl init                      # 프로젝트에 이식 (주석 룰 + 코드맵)
cfl run uvicorn main:app      # 평소 실행 명령 앞에 cfl run만 붙이기
cfl ui                        # http://127.0.0.1:7411 에서 확인
```

---

## 목차

- [왜 필요한가요?](#왜-필요한가요)
- [주요 기능](#주요-기능)
- [어떻게 동작하나요?](#어떻게-동작하나요)
- [설치 가이드](#설치-가이드)
- [사용 가이드](#사용-가이드)
- [명령어 정리](#명령어-정리)
- [자주 묻는 질문 · 문제 해결](#자주-묻는-질문--문제-해결)
- [지원 범위와 로드맵](#지원-범위와-로드맵)
- [저장소에서 개발하기](#저장소에서-개발하기)

---

## 왜 필요한가요?

LLM(Claude Code, Cursor 등)으로 빠르게 만든 시스템은 금방 이런 상태가 됩니다.

- 버튼 하나를 눌렀을 때 **어떤 함수들이 어떤 순서로** 불리는지 모른다.
- **어떤 기능·메서드가 만들어져 있는지**, 서로 어떻게 연결되는지 한눈에 안 보인다.
- 요청 데이터·엔티티가 **어떤 값으로 어디까지 전달되는지** 확인하려면 print를 여기저기 넣어야 한다.
- 함수 이름만 봐서는 **비즈니스적으로 무슨 일을 하는지** 알기 어렵다.

CodeFlowLens는 세 가지 장치로 이 문제를 풉니다.

| 장치 | 하는 일 |
|---|---|
| **① 주석 룰** | LLM이 개발할 때 모든 함수·엔티티에 "개요/로직/참고" 형식의 비즈니스 설명을 달도록 프로젝트에 룰을 심습니다. 이미 있는 코드는 코딩 에이전트로 한 번에 소급합니다. |
| **② 자동 추적** | 앱을 `cfl run`으로 실행하기만 하면 함수 호출 흐름·파라미터·리턴값·예외를 기록합니다. **추적용 코드를 프로젝트에 남기지 않습니다** (log4j/AOP처럼 붙기만 함). |
| **③ 시각화 UI** | 실행 흐름(호출 트리), 메서드 관계도, 엔티티 관계도, 주석 커버리지를 로컬 웹 화면으로 보여줍니다. |

> 주석 예시 — 코드가 아니라 **업무**를 설명합니다.
> - BAD: `plus_count를 호출합니다.`
> - GOOD: `재고 수량을 추가합니다.`

**이런 용도에 씁니다**

- LLM이 만든 코드를 리뷰하거나 인수인계 받을 때, 실제 동작 흐름부터 파악하기
- 버그 재현 후 "어느 함수에서 어떤 값이 들어와 어디서 틀어졌는지" 호출 트리로 추적하기
- 새로 합류한 사람이 시스템 전체 구조(기능·엔티티·관계)를 빠르게 익히기
- 코딩 에이전트가 주석 룰을 잘 지키고 있는지 커버리지로 관리하기

> CodeFlowLens는 **개발 환경용**입니다. `cfl run`으로 켤 때만 동작하고, 그냥 실행하면 아무 일도 하지 않습니다(오버헤드 0). 운영 서버 상시 모니터링 도구가 아닙니다.

---

## 주요 기능

### 1. 비즈니스 주석 룰 셋팅 (`cfl init`, `cfl check`)

- `AGENTS.md`에 주석 룰을 자동으로 넣습니다. Claude Code·Cursor·Codex 등 코딩 에이전트는 이 파일을 읽고 이후 코드를 쓸 때마다 룰에 맞춰 주석을 답니다. `CLAUDE.md`가 있으면 참조 한 줄도 추가합니다.
- 함수는 `개요`(필수) · `로직`(필수) · `참고`(선택), 엔티티 클래스는 `개요` · `파라미터`(필드 설명) · `참고` 형식입니다. 영문 라벨(`Overview/Logic/Note/Fields`)도 인식합니다.
- `cfl check`가 룰 위반(주석 누락·형식 오류)을 목록으로 보여주고, 위반이 있으면 종료코드 1을 돌려줍니다 → CI에 그대로 연결할 수 있습니다.
- 기존 코드 소급용 **에이전트 스킬**(`.claude/skills/codeflowlens-retrofit/`)과 작업지시서(`.codeflowlens/RETROFIT.md`)를 만들어 줍니다. 에이전트에게 "codeflowlens-retrofit 스킬로 주석 소급해줘" 한 마디면 됩니다.

### 2. 코드 수정 없는 자동 추적 (`cfl run`)

- **Python**: 실행 시점에 추적기를 주입합니다. 3.12+는 저오버헤드 공식 API(`sys.monitoring`), 3.9~3.11은 `sys.settrace`를 씁니다.
- **Node/TypeScript**: 모듈을 불러올 때 **메모리에서만** 계측 코드를 끼워 넣습니다. 디스크의 원본 파일은 바뀌지 않습니다. ESM/CJS, tsx·ts-node·빌드된 JS를 지원합니다.
- **내 프로젝트 코드만** 추적합니다. 라이브러리(site-packages, node_modules)와 표준 라이브러리는 제외됩니다.
- 웹 요청 1건 = 트레이스 1건으로 묶습니다 (Python: FastAPI·Starlette / Node: Express·Nest·Fastify·Next API 등 http 서버 전반). 웹이 아니면 실행 1번 = 트레이스 1건, Node의 웹소켓·타이머 같은 외부 이벤트는 이벤트 1건 = 트레이스 1건입니다.
- Flask·Django처럼 Starlette 기반이 아닌 웹 앱도 추적은 되지만, 아직 요청별로 나누지 않고 서버 실행 전체가 트레이스 1건으로 기록됩니다.
- 파라미터·리턴값·예외를 **값 그대로** 저장합니다 (값 1개당 기본 64KB까지, 설정에서 변경).
- async 흐름도 끊기지 않고 이어서 기록합니다.

### 3. 프론트엔드 ↔ 백엔드 연결 (React/Vite)

- Vite 설정에 플러그인 1줄(`codeflowlensDev()`)이면 **개발 모드에서만** 브라우저의 API 호출(fetch/XHR)이 기록됩니다.
- 브라우저 요청과 백엔드 트레이스가 자동으로 이어져서, **"어느 화면의 어떤 동작 → 백엔드의 어떤 흐름"**을 한 번에 볼 수 있습니다.
- `cfl init`이 vite.config를 찾아 플러그인을 자동으로 연결해 줍니다.

### 4. 모니터링 화면 (`cfl ui`)

| 화면 | 보여주는 것 |
|---|---|
| **트레이스** | 최근 실행·요청 목록 (시각, 진입점, 소요시간, 성공/에러, 화면 발 요청 표시). 기간·상태·종류(요청/이벤트/프로세스)·서비스·진입점으로 필터 |
| **트레이스 상세** | 호출 트리 + 소요시간 막대. 함수를 누르면 **개요/로직/참고 주석, 파라미터·리턴값(JSON), 에러 스택** |
| **메서드 관계도** | 정적 분석으로 찾은 호출 관계 + 실제 실행에서 확인된 호출을 함께 표시. 이름·파일·설명으로 검색, 크게 보기, 주석·파일 위치·호출 수·관련 실행 기록 확인 |
| **엔티티** | 데이터 모델(Pydantic·SQLAlchemy·dataclass / interface·type·class·Prisma) 목록과 필드·주석, 엔티티 관계도, **이 엔티티를 쓰는 함수** 목록 |
| **커버리지** | 비즈니스 주석이 달린 함수 비율, 주석이 없는 함수 목록 → 소급 작업 대상 확인 |
| **설정** | 데이터 보존 주기(기본 7일), 파라미터/리턴값 크기 상한, 추적 제외 진입점 관리 |

- 소스 파일을 저장하면 **코드맵(주석·관계도·엔티티)이 자동으로 갱신**됩니다. 화면 상단의 "지금 갱신" 버튼으로 수동 갱신도 됩니다.
- 보존 주기가 지난 실행 기록은 매일 자동으로 정리됩니다. 코드맵·엔티티 정보는 유지됩니다.
- 화면은 `127.0.0.1`에서만 열립니다 (외부에 노출되지 않음).

### 5. 추가 인프라 0 · 안전 원칙

- 모든 기록은 프로젝트 안의 **SQLite 파일 하나**(`.codeflowlens/data.db`)에 저장됩니다. DB 서버·에이전트·클라우드 계정이 필요 없습니다.
- 추적기는 **절대 앱을 죽이지 않습니다** — 추적기 내부에서 문제가 생기면 추적만 멈추고 앱은 계속 돌아갑니다.
- 기록은 백그라운드에서 모아서 저장하므로 앱 실행을 막지 않습니다.

---

## 어떻게 동작하나요?

```
┌──────────────── 내 프로젝트 ────────────────┐
│                                             │
│  React 프론트 ── (API 호출 기록) ──────┐    │
│  Python 백엔드 ─┐                      │    │
│  Node 백엔드  ──┤ (함수 호출 기록)     │    │
└─────────────────┼──────────────────────┼────┘
                  ▼                      ▼
        ┌──────────────────┐    ┌──────────────────┐
        │ .codeflowlens/   │◀──▶│ UI 서버 (cfl ui) │
        │   data.db        │    │ 127.0.0.1:7411   │
        │ (SQLite 한 파일) │    └──────────────────┘
        └──────────────────┘
                  ▲
       cfl scan / init (정적 분석: 함수·주석·호출관계·엔티티)
```

- **정적 분석**(scan): 코드를 읽어 함수·주석·호출 관계·엔티티를 "지도(코드맵)"로 만듭니다. 실행하지 않은 코드도 지도에 나옵니다.
- **실행 기록**(run): 실제로 불린 함수와 값을 기록합니다.
- UI는 둘을 **함수 ID로 겹쳐서** 보여줍니다. 그래서 "전체 지도 위에서 실제로 지나간 길"을 볼 수 있습니다.

배포 패키지는 3개이고, 프로젝트에 있는 언어에 맞게 고르면 됩니다.

| 패키지 | 설치 | 역할 |
|---|---|---|
| [`codeflowlens`](https://pypi.org/project/codeflowlens/) | `pip` | Python 추적기 + Python 정적 분석 + CLI (`init` / `run` / `scan` / `check` / `ui`) |
| [`@codeflowlens/node`](https://www.npmjs.com/package/@codeflowlens/node) | `npm` | Node/TS 추적기 + TS 정적 분석 + Vite 플러그인 + CLI (`run` / `scan` / `check` / `ui`) |
| [`@codeflowlens/ui`](https://www.npmjs.com/package/@codeflowlens/ui) | 자동 (`npx`) | 모니터링 화면. `cfl ui`가 알아서 받아 실행하므로 따로 설치하지 않아도 됩니다 |

---

## 설치 가이드

### 준비물

| 항목 | 버전 | 용도 |
|---|---|---|
| Python | 3.9 이상 (**3.12 이상 권장** — 추적 오버헤드가 훨씬 작음) | Python 프로젝트 추적, `cfl init` |
| Node.js | 20 이상 | 모니터링 화면(`cfl ui`), Node/TS 프로젝트 추적 |

> 순수 Python 프로젝트라도 **화면을 보려면 Node 20+가 필요**합니다. Node만 깔려 있으면 `cfl ui`가 화면 패키지를 자동으로 내려받습니다.

### A. Python 프로젝트 (FastAPI · Flask · Django · 스크립트 등)

```bash
# 프로젝트의 가상환경을 켠 상태에서
pip install codeflowlens

cfl --help          # 설치 확인
```

`cfl` 대신 `codeflowlens`라고 쳐도 똑같이 동작합니다.

### B. Node / TypeScript 프로젝트 (Express · Nest · Fastify · Next API 등)

```bash
npm i -D @codeflowlens/node      # 프로젝트 개발 의존성으로 설치
npx cfl --help                   # 설치 확인
```

프로젝트 안에 설치되므로 명령 앞에 `npx`를 붙입니다 (`npx cfl run ...`).

> **주석 룰 셋팅(`cfl init`)은 현재 Python 패키지에 들어 있습니다.** TS 전용 프로젝트도 룰을 심으려면 `pipx install codeflowlens`(또는 `pip install codeflowlens`)로 한 번 설치해서 `cfl init`을 실행하세요. 추적·스캔·검사·화면은 Node 패키지만으로 됩니다.

### C. 풀스택 (Python 백엔드 + React 프론트, Node 백엔드 + React 등)

```bash
pip install codeflowlens          # 백엔드가 Python이면
npm i -D @codeflowlens/node       # 프론트(Vite 플러그인)·Node 백엔드용
cfl init                          # vite.config에 플러그인까지 자동 연결
```

`cfl init`이 vite.config를 자동으로 고치지 못한 경우(구조가 특이할 때)에는 직접 한 줄 추가하세요.

```ts
// vite.config.ts
import { codeflowlensDev } from "@codeflowlens/node/vite";

export default defineConfig({
  plugins: [react(), codeflowlensDev()],
  // 백엔드는 프록시로 연결하는 것을 권장 (같은 출처가 되어 트레이스 연결이 안정적)
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
```

### 업데이트 · 삭제

```bash
pip install -U codeflowlens               # 업데이트
npm i -D @codeflowlens/node@latest

pip uninstall codeflowlens                # 삭제
npm uninstall @codeflowlens/node
```

삭제 후 프로젝트에 남는 것은 `.codeflowlens/` 폴더(기록 데이터)와 `AGENTS.md`의 룰 블록(`<!-- codeflowlens:rules:start -->` ~ `end`)뿐입니다. 필요 없으면 지우면 됩니다.

---

## 사용 가이드

### 1단계 — 프로젝트에 이식하기: `cfl init`

프로젝트 루트에서 한 번만 실행합니다.

```bash
cd <내 프로젝트>
cfl init                          # 언어 자동 감지
cfl init --lang python,browser    # 언어를 직접 지정 (python, node, browser)
```

`init`이 하는 일 (기존 파일은 지우지 않고 필요한 부분만 추가합니다):

| 생성/수정 | 내용 |
|---|---|
| `AGENTS.md` | 비즈니스 주석 룰 블록 추가 (있으면 블록만 갱신) |
| `CLAUDE.md` | 있으면 AGENTS.md 룰을 따르라는 참조 1줄 추가 |
| `.claude/skills/codeflowlens-retrofit/` | 기존 코드에 주석을 소급하는 에이전트 스킬 |
| `.codeflowlens/config.toml` | 감지된 언어 설정 |
| `.codeflowlens/RETROFIT.md` | 소급 작업지시서 (스킬이 없는 에이전트용 프롬프트 포함) |
| `.codeflowlens/USAGE.md` | 이 프로젝트용 사용법 요약 |
| `.gitignore` | `.codeflowlens/` 추가 (기록 데이터는 git에 올리지 않음) |
| `vite.config.*` | 프론트가 있으면 `codeflowlensDev()` 플러그인 연결 |

마지막으로 첫 정적 분석을 돌리고 결과를 보여줍니다.

```
CodeFlowLens 이식 완료 (언어: python)
  · 첫 스캔 (Python): 함수 12개, 주석 커버리지 41.7%, 엔티티 4개
```

> `AGENTS.md`, `CLAUDE.md`, `.claude/skills/`는 git에 커밋하세요. 팀원과 코딩 에이전트가 같은 룰을 쓰게 됩니다.

### 2단계 — 기존 코드에 주석 채우기: `cfl check` + 에이전트

```bash
cfl check            # 룰 위반 함수/클래스 목록
cfl check --json     # 에이전트·스크립트가 읽기 좋은 형식
```

위반이 있으면 코딩 에이전트에게 맡깁니다.

- **Claude Code**: `codeflowlens-retrofit 스킬로 주석 소급 작업해줘`
- **그 밖의 에이전트**: `.codeflowlens/RETROFIT.md`에 있는 프롬프트를 복사해서 붙여 넣기

에이전트가 주석을 채우고 `cfl check` 통과까지 스스로 확인합니다. 사람은 몇 개를 골라 **주석이 실제 업무 의미와 맞는지**만 확인하면 됩니다.

이후 새로 짜는 코드는 `AGENTS.md` 룰 덕분에 처음부터 주석이 달린 채로 만들어집니다.

### 3단계 — 추적하면서 실행하기: `cfl run`

평소 실행 명령 앞에 `cfl run`만 붙입니다.

```bash
# Python
cfl run uvicorn main:app --reload
cfl run python batch_job.py
cfl run pytest                       # 테스트가 지나가는 흐름도 기록됩니다

# Node / TypeScript  (@codeflowlens/node 설치 필요)
npx cfl run node server.js
npx cfl run npx tsx src/server.ts
npx cfl run npm run dev
```

- Python 패키지의 `cfl run`은 `@codeflowlens/node`가 설치돼 있으면 **Node 프로세스도 함께 추적**합니다.
- 그다음 평소처럼 앱을 쓰면(화면 클릭, API 호출, 테스트 실행 등) 기록이 쌓입니다.
- `cfl run` 없이 실행하면 아무것도 기록하지 않습니다.

### 4단계 — 화면으로 보기: `cfl ui`

```bash
cfl ui                     # → http://127.0.0.1:7411
cfl ui --port 8080         # 포트 변경
npx cfl ui                 # Node 패키지로 띄우기
```

브라우저에서 `http://127.0.0.1:7411`을 엽니다. 추천 순서는 이렇습니다.

1. **트레이스** 탭에서 방금 한 동작(예: `POST /orders`)을 고릅니다. 에러 난 요청만 보려면 상태 필터를 쓰세요.
2. **호출 트리**에서 함수를 하나씩 눌러 봅니다 → 오른쪽에 **개요/로직/참고 주석**, **들어온 파라미터와 리턴값**, 에러가 났다면 **스택**이 나옵니다.
3. **메서드 관계도**에서 그 함수가 누구를 부르고 누구에게 불리는지 확인합니다. 함수를 고르면 직접 연결된 선이 붉게 강조되고, 아직 한 번도 실행되지 않은 함수는 조금 흐리게 보입니다.
4. **엔티티** 탭에서 데이터 모델의 필드·관계와, 그 엔티티를 쓰는 함수 목록을 봅니다.
5. **커버리지** 탭에서 주석이 빠진 함수를 확인하고, 필요하면 2단계 소급 작업을 다시 시킵니다.

UI가 켜져 있는 동안 소스를 저장하면 코드맵이 자동으로 다시 스캔됩니다. UI 없이 갱신하려면 `cfl scan`을 실행하세요.

### 설정 바꾸기

화면의 **설정** 탭에서 바꿉니다. 보존 주기·추적 제외는 저장 즉시, 크기 상한은 다음 `cfl run`부터 적용됩니다.

| 설정 | 기본값 | 설명 |
|---|---|---|
| 데이터 보존 주기 | 7일 | 이보다 오래된 실행 기록을 매일 자동 삭제 (코드맵은 유지) |
| 파라미터/리턴값 크기 상한 | 64KB | 값 1개가 이보다 크면 잘라서 저장 |
| 추적 제외 진입점 | 없음 | 헬스체크·폴링처럼 기록할 필요 없는 진입점을 제외. 트레이스 상세의 "🚫 이 진입점 추적 안 함" 버튼으로도 추가 |

### 일상적인 개발 흐름

```
코딩 에이전트에게 기능 개발 요청
   └─ AGENTS.md 룰에 따라 비즈니스 주석이 달린 코드 생성
cfl check                         ← 주석 누락 확인 (에이전트가 스스로 돌리기도 함)
cfl run <평소 실행 명령>          ← 기능을 직접 써 보며 기록
cfl ui                            ← 흐름·값·관계 확인, 이상한 곳 찾기
```

### CI에서 주석 룰 검사하기

`cfl check`는 위반이 있으면 종료코드 1로 끝나므로 그대로 CI 단계에 넣으면 됩니다.

```yaml
# .github/workflows/codeflowlens.yml
name: comment-rules
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install codeflowlens
      - run: cfl check
```

TS 프로젝트는 `npm ci` 후 `npx cfl check`를 실행하세요.

---

## 명령어 정리

모든 명령은 `cfl`(축약)과 `codeflowlens`(정식) 두 이름으로 쓸 수 있습니다.

| 명령 | 설명 | Python 패키지 | Node 패키지 |
|---|---|:---:|:---:|
| `cfl init [--lang a,b]` | 프로젝트에 이식 (주석 룰 + 스킬 + 첫 스캔) | ✅ | — |
| `cfl run <명령> [인자...]` | 명령을 추적 상태로 실행 | ✅ | ✅ |
| `cfl scan` | 코드맵(함수·주석·관계도·엔티티) 갱신 | ✅ | ✅ |
| `cfl check [--json]` | 주석 룰 검사 (위반 시 종료코드 1) | ✅ | ✅ |
| `cfl ui [옵션]` | 모니터링 화면 열기 | ✅ | ✅ |

`cfl ui` 옵션 (UI 서버 `codeflowlens-ui` / `cfl-ui`와 같습니다):

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--port <N>` | `7411` | 화면 포트 |
| `--db <경로>` | `<프로젝트>/.codeflowlens/data.db` | 읽을 기록 파일 |
| `--project <경로>` | DB 위치에서 추정 | 코드맵을 스캔할 프로젝트 폴더 |
| `--no-watch` | (감지 켬) | 파일 저장 시 자동 재스캔 끄기 |
| `--scan-cmd "<명령>"` | 자동 탐지 | 재스캔에 쓸 명령 직접 지정 (예: `".venv/bin/cfl scan"`) |

---

## 자주 묻는 질문 · 문제 해결

**운영 서버에 설치돼 있어도 괜찮나요?**
네. `cfl run`으로 실행하지 않으면 추적기는 아예 켜지지 않습니다(오버헤드 0). 다만 개발용 도구이므로 운영 의존성에는 넣지 않는 것을 권장합니다 (Python은 dev 의존성, Node는 `-D`).

**추적하면 앱이 느려지나요?**
개발 환경 기준으로 감수할 만한 수준을 목표로 합니다. Python 3.12 이상은 공식 저오버헤드 API를 써서 가볍고, 3.9~3.11은 같은 기능을 하지만 더 느릴 수 있습니다.

**`cfl ui`에서 "Node 20 이상이 필요합니다"라고 나와요.**
화면은 Node로 동작합니다. [nodejs.org](https://nodejs.org)에서 Node 20 이상을 설치한 뒤 다시 실행하세요.

**화면에 트레이스가 하나도 없어요.**
- 앱을 `cfl run ...`으로 실행했는지 확인하세요.
- 실행한 폴더와 `cfl ui`를 띄운 폴더가 같은 프로젝트인지 확인하세요 (기록은 프로젝트 루트의 `.codeflowlens/data.db`).
- 라이브러리 코드는 추적하지 않습니다. 내 코드가 한 번도 안 불렸다면 기록도 없습니다.

**함수 설명이 "주석 없음"으로 나와요.**
주석이 없거나 룰 형식(`개요:` / `로직:`)이 아닌 경우입니다. `cfl check`로 확인하고 소급 작업(사용 가이드 2단계)을 진행하세요. 주석을 고친 뒤 화면에 안 보이면 `cfl scan` 또는 화면의 "지금 갱신"을 누르세요.

**Flask·Django 요청이 요청별로 안 나뉘고 하나로 뭉쳐 있어요.**
현재 Python의 요청별 묶기는 ASGI(FastAPI·Starlette) 기준입니다. WSGI 앱도 함수 호출·값은 모두 기록되지만 서버 실행 전체가 트레이스 1건이 됩니다. WSGI 요청별 묶기는 다음 버전에 넣을 예정입니다.

**프론트 요청이 백엔드 트레이스와 연결되지 않아요.**
`vite.config`에 `codeflowlensDev()`가 들어 있는지, 개발 모드(`vite dev`)로 띄웠는지 확인하세요. 백엔드는 Vite `server.proxy`로 연결하는 것을 권장합니다.

**기록 데이터를 지우고 싶어요.**
`.codeflowlens/data.db*` 파일을 지우면 됩니다. 코드맵은 `cfl scan`으로 다시 만들 수 있습니다.

**`.codeflowlens/` 폴더는 git에 올려야 하나요?**
아니요. 실행 기록이 들어 있으므로 `init`이 자동으로 `.gitignore`에 추가합니다. 대신 `AGENTS.md`와 `.claude/skills/`는 커밋하세요.

---

## 지원 범위와 로드맵

**현재 (v0.1)**

- Python 3.9+ — FastAPI · Starlette(요청별 트레이스), Flask · Django(WSGI, 실행 단위 트레이스), 일반 스크립트
- Node 20+ / TypeScript — Express · Nest · Fastify · Next API 등 (tsx · ts-node · 빌드된 JS)
- React(Vite) 프론트의 API 호출 → 백엔드 흐름 연결
- 엔티티: Pydantic · SQLAlchemy · dataclass / interface · type · class · Prisma

**다음 후보**

- Flask · Django(WSGI) 요청별 트레이스
- 브라우저 코드의 함수 단위 추적
- Spring Boot(Java) 추적기
- 팀 공유 모드 (중앙 DB)
- 트레이스 비교 ("어제와 다르게 동작한 이유")

설계와 결정 배경은 [docs/PRD.md](docs/PRD.md)에 있습니다. 버그 제보·제안은 [Issues](https://github.com/exceedlimit/codeflowlens/issues)에 남겨 주세요.

---

## 저장소에서 개발하기

### 구조

| 위치 | 내용 |
|---|---|
| `packages/schema` | 언어 중립 SQLite 스키마 (모든 추적기·UI가 따르는 계약) |
| `packages/python` | PyPI `codeflowlens` — Python 추적기 + 정적 분석기 + CLI |
| `packages/node` | npm `@codeflowlens/node` — Node 추적기 + TS 정적 분석기 + Vite 플러그인 + CLI |
| `packages/ui` | npm `@codeflowlens/ui` — 모니터링 화면 (Fastify + React) |
| `examples/` | 데모 앱 (FastAPI, Express, React) — E2E 검증용 |
| `docs/` | PRD(설계 기준 문서), 원본 요건 |
| `plans/` | 마일스톤별 구현 계획 |

### 소스에서 실행

```bash
pip install -e "packages/python[dev]"                    # cfl 명령 (수정 즉시 반영)
(cd packages/node && npm install && npm run build)
(cd packages/ui && npm install && npm run build)
node packages/ui/dist/server/cli.js --db <내 프로젝트>/.codeflowlens/data.db
```

### 데모로 바로 보기

```bash
cd examples/fastapi-demo
pip install -r requirements.txt
cfl run uvicorn main:app --port 8000 &
./traffic.sh                    # 요청 몇 개 보내기
cfl ui
```

### 테스트

```bash
(cd packages/python && python -m pytest)
npm test --prefix packages/node
npm test --prefix packages/ui
```

---

## 라이선스

[Apache License 2.0](LICENSE) © 2026 exceedlimit
