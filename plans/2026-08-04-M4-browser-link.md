# M4 구현 계획 — 브라우저 API 기록 + 프론트↔백 연결

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React 데모에서 버튼 클릭 → 백엔드 흐름까지 한 트레이스로 표시. Vite 설정 1줄(`flowlensDev()`)로 개발 모드에서만 브라우저 API 호출이 기록되고, `x-flowlens-trace` 헤더로 백엔드 트레이스와 연결된다.

**Architecture:** (PRD 7절) @flowlens/node에 브라우저 스크립트(fetch/XHR 패치)와 Vite 플러그인 포함. 스크립트는 요청마다 trace id를 만들어 헤더로 붙이고(백엔드가 client_trace_id로 저장 — M1·M3에서 이미 구현됨), 기록을 UI 서버 수집 엔드포인트로 전송. UI 서버는 client_events에 저장(쓰기 연결 추가), 트레이스 상세에서 조인해 "어느 페이지에서 온 요청"을 표시.

**완료 기준 (PRD 12절 M4):** React 데모에서 버튼 클릭 → 백엔드 흐름까지 한 트레이스로 표시

## 설계 확정 사항

- **전송 방식**: 원본 fetch + `Content-Type: text/plain`(CORS preflight 없는 단순 요청, fire-and-forget). 수집 엔드포인트 자신으로 가는 요청은 기록하지 않는다(재귀 방지). UI 서버 꺼져 있으면 조용히 버림.
- **헤더 부착**: 같은 출처(또는 Vite 프록시 경유) 요청에만 안전 — 데모는 Vite proxy 관행 사용, 문서에 프록시 권장 명시.
- **client_events.trace_id = 생성한 trace id = 백엔드 traces.client_trace_id** → 조인 키.
- **주입**: Vite `transformIndexHtml`로 빌드된 스크립트를 인라인 주입, `apply: "serve"`(dev 전용). 엔드포인트는 옵션(기본 http://127.0.0.1:7411/api/client-events).
- **UI 서버 쓰기**: client_events 기록용 쓰기 연결 추가(DB 없으면 무시). 응답에 CORS 허용 헤더.

## Tasks

### Task 1: 브라우저 스크립트 (@flowlens/node src/browser.ts)
- [x] 1-1. 실패 테스트(jsdom 유사 — fetch/XHR 가짜로): fetch 패치 후 호출 → 헤더 부착 + report 전송(원본 fetch로, text/plain), 엔드포인트 요청은 미기록, 예외 시 그대로 전파 + 실패 기록
- [x] 1-2. 구현(iife 번들 엔트리 추가) → PASS → 커밋 `M4: 브라우저 기록 스크립트`

### Task 2: Vite 플러그인 (src/vite-plugin.ts)
- [ ] 2-1. 실패 테스트: flowlensDev() 훅 직접 호출 — transformIndexHtml이 스크립트 태그 주입, endpoint 옵션 반영, apply가 serve
- [ ] 2-2. 구현(빌드된 browser 스크립트 읽어 인라인) + exports 추가 → PASS → 커밋 `M4: Vite 플러그인`

### Task 3: UI 서버 수집 엔드포인트 + 연결 표시 API
- [ ] 3-1. 실패 테스트: POST /api/client-events(text/plain JSON) → client_events 행 저장·CORS 헤더, DB 없으면 200 + 무시. GET /api/traces/:id 응답에 client_event(page_url 등) 조인 포함. 목록 응답에 client_trace_id 유무
- [ ] 3-2. 구현(쓰기 연결) → PASS → 커밋 `M4: 수집 엔드포인트 + 조인`

### Task 4: UI 화면 연결 표시
- [ ] 4-1. TraceDetail 헤더에 "🌐 <페이지 경로>에서 발생 (프론트 소요 Xms)" 표시, TraceList에 출처 표시 → 빌드 → 커밋 `M4: 프론트 출처 표시`

### Task 5: React 데모 + E2E
- [ ] 5-1. examples/react-demo: Vite+React, 버튼 3개(재고 조회/주문/재고부족 주문), vite proxy → express-demo(8300), vite.config에 flowlensDev() 1줄
- [ ] 5-2. E2E: express-demo 추적 실행 + UI 서버 + react dev → 브라우저에서 버튼 클릭 → 트레이스 상세에 페이지 출처 + 백엔드 체인 확인(스크린샷) → 커밋 `M4: E2E 검증 완료`

## Self-Review: PRD G7·7절(브라우저 기록)·9절 ②(출처 표시) 커버. 헤더 CORS 리스크는 프록시 관행 + 문서화로 처리. 플레이스홀더 없음.
