# M3 구현 계획 — Node 추적기 + TS 정적 분석

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express/Node 데모를 `flowlens run node server.js`(또는 npm run dev)로 실행하면 함수 호출 트리가 SQLite에 기록되고, TS 정적 분석으로 관계도/엔티티가 채워져 M1·M2와 동일한 UI 경험을 제공한다.

**Architecture:** (PRD 7절) 디스크 원본 불변 — Node module hooks(ESM)와 Module._compile 패치(CJS)로 **로드 시점에 메모리에서만** 바벨 변환을 적용해 함수 본문을 `__flowlens.wrap()`으로 감싼다. 부모 추적은 `AsyncLocalStorage.run(span, body)` — 컨텍스트가 "async 작업이 시작된 시점"에 캡처되는 시맨틱이라 await를 건너도 부모가 정확하다. 요청 그룹핑은 http.Server의 request 이벤트 패치. 정적 분석은 ts-morph로 Python 스캐너와 동일한 스키마에 저장(language='typescript').

**Tech Stack:** TypeScript, @babel/core(+preset-typescript는 불필요 — tsx/ts-node 뒤에 체인), better-sqlite3, AsyncLocalStorage, ts-morph, vitest, tsup(빌드)

**완료 기준 (PRD 12절 M3):** Express 데모에서 M1·M2와 동일 수준 동작 (추적 + scan/check + UI 3화면)

---

## 설계 확정 사항

- **계측 변환**: 함수 본문을 `return __flowlens.wrap("<fid>", {인자}, () => { ...원본... })`로 감싼다(화살표 함수는 this/arguments/super/new.target을 상속하므로 안전). async 함수는 async 화살표로. **제너레이터는 v1 미계측**(화살표로 표현 불가) — 스팬 없이 통과.
- **wrap 런타임**: `parent = als.getStore()` → span 생성 → `als.run(span, fn)` 실행 → 결과가 thenable이면 then/catch로 종료 기록, 아니면 즉시 기록. 예외는 그대로 재던짐(fail-open).
- **대상 파일 판정**: Python CodeFilter와 동일 규칙 — 프로젝트 루트 하위, node_modules/.venv 등 제외, 파일 확장자 .js/.mjs/.cjs/.ts/.mts/.jsx/.tsx.
- **TS 소스 로딩**: tsx/ts-node가 앞서 변환하도록 로더 체인 활용(우리 훅이 nextLoad 결과를 계측). 직접 .ts를 우리가 변환하지는 않는다(런타임은 항상 JS를 받음). CJS는 Module._compile 패치로 동일 계측.
- **function_id**: `<상대경로>::<qualname>` — 정적 분석과 추적이 같은 규칙. qualname: 함수선언=이름, 메서드=`Class.method`, `const f = () =>`는 `f`, 익명/콜백은 `<anonymous@줄번호>`(정적 분석 미대상, 추적만). **주의: 추적은 소스 위치 기반으로 fid를 만들므로 tsx 변환 후에도 원본 경로 유지(소스맵 불요 — 로더가 원본 URL을 안다).**
- **요청 그룹핑**: `http.Server.prototype.emit` 패치 — 'request'(req,res)에서 trace 시작(als.run으로 핸들러 체인 감쌈), res 'finish'에서 status와 함께 종료. x-flowlens-trace 헤더 → client_trace_id. Express/Fastify/Nest 모두 node:http 위라 공통 동작.
- **writer**: better-sqlite3(동기) — 이벤트를 배열 버퍼에 쌓고 250ms 타이머 + exit 훅에서 트랜잭션 flush. WAL. 오류 시 자기 비활성화.
- **TS 엔티티 판정**: interface, 객체형 type alias, 필드형 class. 필드 = 프로퍼티 시그니처(이름/타입/JSDoc `파라미터` 설명 매칭).
- **JSDoc 파서**: docparse.py와 동일 라벨 규칙의 TS 구현(공용 테스트 케이스 복제).
- **CLI**: npm 패키지 bin `flowlens`(node용 run/scan/check). 또한 **Python CLI의 run이 node_modules/@flowlens/node 존재 시 NODE_OPTIONS 주입을 추가** → 풀스택에서 `flowlens run` 하나로 양쪽 추적.
- **스키마 사본**: packages/node/src/db/schema.sql — vitest로 packages/schema와 동기화 검증(파이썬과 동일 패턴).

## 파일 구조

```
packages/node/
  package.json  tsconfig.json  tsup.config.ts
  src/register.mts        # --import 진입점: module.register + CJS 패치 설치
  src/hooks.mts           # ESM load 훅 (nextLoad → instrument)
  src/cjs-hook.ts         # Module._compile 패치
  src/instrument.ts       # 바벨 플러그인: 함수 본문 wrap 삽입
  src/runtime.ts          # __flowlens 전역: wrap/스팬 조립/ALS
  src/http-hook.ts        # 요청 그룹핑
  src/filter.ts           # 대상 파일 판정
  src/serialize.ts        # 값 직렬화 (파이썬과 동일 규칙)
  src/writer.ts           # better-sqlite3 배치 writer
  src/db/schema.sql       # 사본
  src/cli.ts              # flowlens run/scan/check (node)
  src/analyzer/docparse.ts  # JSDoc 라벨 파서
  src/analyzer/tsscan.ts    # ts-morph 스캐너
  src/analyzer/store.ts     # DB 저장 (language='typescript')
  tests/*.test.ts
examples/express-demo/    # 재고/주문 Express 앱 (주석 룰 적용, CJS 아닌 ESM)
```

---

### Task 1: 패키지 뼈대 + 스키마 동기화
- [x] 1-1. package.json(deps: @babel/core, better-sqlite3, ts-morph; bin flowlens→dist/cli.js), tsup 빌드, vitest, 스키마 사본 + 동기화 테스트
- [x] 1-2. 커밋 `M3: Node 패키지 뼈대`

### Task 2: 직렬화 + 필터
- [x] 2-1. 실패 테스트: serialize(기본형/객체→__type__/순환→fail-open/64KB 상한), filter(루트 하위 true, node_modules/파생 폴더 false, 지원 확장자만)
- [x] 2-2. 구현 → PASS → 커밋 `M3: 직렬화+필터`

### Task 3: writer (better-sqlite3 배치)
- [x] 3-1. 실패 테스트: trace/span/edge 기록, flush 주기, close 시 잔여 flush, 나쁜 행 무시
- [x] 3-2. 구현(파이썬 writer와 동일 인터페이스) → PASS → 커밋 `M3: writer`

### Task 4: 런타임 (wrap + ALS 부모 추적)
- [x] 4-1. 실패 테스트(계측 없이 runtime 직접 호출): 동기 중첩 wrap → 부모/자식 스팬, async wrap 체인 → await 뒤 호출도 부모 정확, 예외 → error 스팬 + 재던짐, runtime_edge 기록
- [x] 4-2. 구현: initRuntime(env) → globalThis.__flowlens = {wrap}, 프로세스 트레이스 시작, exit 훅 → PASS → 커밋 `M3: 런타임`

### Task 5: 바벨 계측 변환
- [x] 5-1. 실패 테스트: 샘플 소스 instrument() 후 (a) 코드에 __flowlens.wrap 포함 (b) new Function/vm으로 실행하면 스팬 트리 정확 (c) 함수선언/화살표/메서드/async 모두 계측 (d) 제너레이터는 원본 유지 (e) 파싱 실패 소스는 원본 그대로 반환(fail-open)
- [x] 5-2. 구현: babel plugin — Function 계열 노드 본문 치환, fid = relpath::qualname(스코프 추적) → PASS → 커밋 `M3: 계측 변환`

### Task 6: 로더 훅 + run CLI 통합
- [x] 6-1. 실패 테스트(subprocess 통합): 픽스처 ESM 프로젝트를 `node --import <register>` + env로 실행 → DB에 스팬, CJS(require) 픽스처도 동일, env 없으면 no-op
- [x] 6-2. register.mts/hooks.mts/cjs-hook.ts + cli.ts run(NODE_OPTIONS 주입 spawn) → PASS → 커밋 `M3: 로더 훅 + run`
- [x] 6-3. Python CLI run에 NODE_OPTIONS 주입 추가(+test) → 커밋 `M3: 풀스택 run 통합`

### Task 7: http 요청 그룹핑
- [x] 7-1. 실패 테스트: 계측된 http 서버에 fetch 2회 → http 트레이스 2건(메서드/경로/상태), 핸들러 스팬 포함, 헤더 → client_trace_id
- [x] 7-2. 구현(emit 패치, als.run으로 감쌈) → PASS → 커밋 `M3: http 그룹핑`

### Task 8: TS 정적 분석 (docparse + tsscan + store + scan/check CLI)
- [x] 8-1. 실패 테스트: JSDoc 라벨 파서(파이썬 테스트 케이스 이식), 함수/메서드/화살표 추출 + fid, interface/type/class 엔티티 + 필드 설명, 호출 관계(보수적), usages, 저장 후 language='typescript'만 교체
- [x] 8-2. 구현 → PASS → 커밋 `M3: TS 정적 분석`
- [x] 8-3. cli.ts에 scan/check 연결(파이썬 check와 동일 판정 룰) → 커밋

### Task 9: Express 데모 + E2E
- [ ] 9-1. examples/express-demo(재고/주문, ESM, 주석 룰 적용) 작성
- [ ] 9-2. `flowlens run node server.js` → traffic → scan → UI 3화면 브라우저 확인(스크린샷) — M1·M2 동등 확인
- [ ] 9-3. 문제 수정 + README 갱신 → 커밋 `M3: E2E 검증 완료`

---

## Self-Review: PRD 7절(Node 추적 방식·ESM/CJS·AsyncLocalStorage·http 그룹핑), 8절(TS 분석), G1(TS 백엔드) 커버. 리스크(PRD 13절 tsx 체인)는 Task 6 테스트에서 tsx 픽스처로 확인. 플레이스홀더 없음.
