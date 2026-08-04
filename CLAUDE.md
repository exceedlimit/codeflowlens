# FlowLens 모노레포

바이브코딩으로 만든 시스템의 실행 흐름·메서드·엔티티를 시각화하는 모니터링 패키지.
**모든 요구사항·설계 결정은 [docs/PRD.md](docs/PRD.md)가 단일 기준이다.** 구현이 PRD와 어긋나면 PRD를 먼저 고치고 사용자에게 알린다.

## 구조

```
docs/          PRD.md(기준 문서), 요건.md(원본 요건)
plans/         마일스톤별 구현 계획 (체크박스로 진행 상태 추적)
packages/
  schema/      공통 SQLite 스키마 정의 + 마이그레이션 (언어 중립)
  python/      pip 패키지 `flowlens`: Python 추적기 + 정적 분석기 + CLI
  node/        npm 패키지 `@flowlens/node`: Node 추적기 + TS 정적 분석기 + Vite 플러그인
  ui/          npm 패키지 `@flowlens/ui`: UI 서버(Fastify) + React 프론트
examples/      데모 앱 (FastAPI+React, Express) — E2E 검증용
```

## 작업 규칙

- **TDD**: 실패하는 테스트 먼저, 구현은 그다음. 테스트 없는 기능 코드 커밋 금지.
- **계획 현행화**: 작업은 `plans/`의 해당 마일스톤 문서 체크박스 순서대로 진행하고, 항목을 끝낼 때마다 체크(`[x]`) 후 커밋한다.
- **커밋 단위**: 계획의 체크박스 1~2개 = 커밋 1개. 메시지는 `M<N>: <무엇을>` 형식.
- **추적기 불변 원칙**: 추적기 코드는 어떤 경우에도 사용자 앱을 죽이면 안 된다(fail-open). 이 원칙을 깨는 코드는 리뷰 없이 반려.
- 사용자 대화는 한국어, 쉬운 표현. 코드 주석은 PRD 6절의 주석 룰을 이 저장소 자신에게도 적용한다(개요/로직/참고).

## 중단 후 재개 방법 (세션이 끊겼을 때)

1. `git log --oneline -10`으로 마지막 커밋 확인
2. `plans/` 에서 첫 미완료 체크박스(`[ ]`)를 찾는다 — 그것이 다음 작업이다
3. 마일스톤 순서: M1 → M2 → M3 → M4 → M5 (PRD 12절)
4. 완료 기준은 각 plan 문서 상단의 "완료 기준" 절을 따른다

## 자주 쓰는 명령

```bash
# Python 패키지 (packages/python)
cd packages/python && python -m pytest              # 테스트
# Node/UI 패키지 (packages/node, packages/ui)
npm test --prefix packages/node                     # 테스트
npm test --prefix packages/ui
```

## 검증 대상 실전 프로젝트 (M5)

- (실전 프로젝트 A — Python 대형 백엔드)
- (실전 프로젝트 B — TypeScript 프로젝트)
