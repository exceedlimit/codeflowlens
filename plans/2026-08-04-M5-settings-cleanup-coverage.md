# M5 구현 계획 — 설정/데이터 정리 + 커버리지 대시보드 + 엔티티 관계도 + 실전 검증

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면(보존 주기 기본 7일)에서 정리 정책을 바꿀 수 있고, 오래된 실행 기록이 자동 삭제되며, 주석 커버리지 대시보드와 엔티티 관계도가 제공되고, 실전 프로젝트 2곳(실전 프로젝트 A, 실전 프로젝트 B)에서 전 기능이 동작한다.

**완료 기준 (PRD 12절 M5):** 두 실전 프로젝트에서 전 기능 동작

## Tasks

### Task 1: 설정 API + 데이터 정리 스케줄러 (UI 서버)
- [x] 1-1. 실패 테스트: GET /api/settings(기본값 7/65536), PUT /api/settings(저장·검증: 양수만), cleanup(retention 지난 traces/spans/client_events 삭제, 코드맵은 유지)
- [x] 1-2. 구현: settings 라우트 + cleanup 함수(기동 시 + 24시간마다, unref 타이머) → PASS → 커밋 `M5: 설정 API + 정리 스케줄러`

### Task 2: 추적기가 설정을 반영 (value_max_bytes)
- [ ] 2-1. Python bootstrap이 DB settings의 value_max_bytes를 읽어 세션에 적용(+test), Node register 동일(+test) → 커밋 `M5: 값 상한 설정 반영`

### Task 3: 설정 화면 (⑤)
- [ ] 3-1. SettingsPage: 보존 주기(일)·값 크기 상한(KB) 입력 + 저장 + 안내문("실행 기록만 정리, 코드맵 유지"). 내비에 '설정' 추가 → 빌드·눈 확인 → 커밋 `M5: 설정 화면`

### Task 4: 주석 커버리지 대시보드
- [ ] 4-1. 실패 테스트: GET /api/coverage — 언어별 {functions, documented, coverage}, 미주석 함수 목록(파일별 그룹, 최대 100)
- [ ] 4-2. CoveragePage: 커버리지 스탯 타일 + 미주석 목록(관계도 링크) + "에이전트에게 시키기" 안내(retrofit) → 커밋 `M5: 커버리지 대시보드`

### Task 5: 엔티티 관계도 뷰
- [ ] 5-1. EntitiesPage에 전체 엔티티 그래프(React Flow, entity_relations 기반) 토글 추가 → 눈 확인 → 커밋 `M5: 엔티티 관계도`

### Task 6: 실전 프로젝트 검증
- [ ] 6-1. 실전 프로젝트 A: 구조 파악 → init(--lang 자동) → scan/check → UI 3+2화면 확인(실행 가능하면 flowlens run으로 트래픽까지)
- [ ] 6-2. 실전 프로젝트 B: 동일 절차
- [ ] 6-3. 발견 문제 수정(회귀 테스트 추가) → 커밋 `M5: 실전 검증 완료`

### Task 7: 마감
- [ ] 7-1. 전체 테스트 3종(pytest/node vitest/ui vitest) 일괄 통과 확인, README·PRD 현행화(미결 반영) → 커밋 → main 머지
