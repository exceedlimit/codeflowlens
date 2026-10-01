# CodeFlowLens 공통 스키마

모든 추적기(Python/Node)와 UI가 따르는 **언어 중립 계약**이다. 원본은 이 폴더의 `schema.sql` 하나이며, 각 패키지는 사본을 내장하고 테스트로 동기화를 검증한다.

- 사본 위치: `packages/python/src/codeflowlens/db/schema.sql` (M3에서 `packages/node`도 추가)
- 동기화 검증: `packages/python/tests/test_schema_sync.py`

## 스키마 변경 절차

1. `schema.sql` 수정 + `schema_version` 기본값 증가
2. 각 패키지의 사본 갱신 (동기화 테스트가 깨지면 잊은 것)
3. 기존 DB 마이그레이션 코드를 각 패키지 `db/connect` 계층에 추가

## 핵심 규칙

**function_id** = `"<프로젝트 루트 기준 상대경로>::<qualified_name>"`
예: `app/services.py::OrderService.add_stock`, `src/routes/order.ts::createOrder`
— 실행 기록(spans)과 정적 분석(functions)을 잇는 조인 키. 추적기와 정적 분석기가 반드시 같은 규칙으로 생성해야 한다.

**시각** = unix epoch 초(REAL). 밀리초 변환은 조회 시 계산.

## 테이블 요약

| 테이블 | 채우는 주체 | 내용 |
|---|---|---|
| `traces` | 추적기 | 실행 묶음 1건 (http 요청 1건 또는 프로세스 실행 1번). `status`: running→ok/error |
| `spans` | 추적기 | 함수 호출 1건. `parent_id`로 호출 트리 구성, `seq`는 트레이스 내 호출 순번. 함수 종료 시 1회 INSERT |
| `functions` | 정적 분석기 | 함수/메서드 정의 + 파싱된 주석(`doc_overview`=개요, `doc_logic`=로직, `doc_note`=참고) |
| `call_edges` | 둘 다 | 호출 관계. `kind=static`(코드에서 발견) / `runtime`(실행에서 관측, `count` 누적) |
| `entities` | 정적 분석기 | 엔티티(데이터 모델 클래스) + 주석(개요/참고) |
| `entity_fields` | 정적 분석기 | 엔티티 필드 + '파라미터' 주석의 필드 설명 |
| `entity_relations` | 정적 분석기 | 엔티티 간 참조(필드 타입 분석) |
| `entity_usages` | 정적 분석기 | 함수↔엔티티 사용 관계 (`role`: param/return) |
| `client_events` | UI 서버(수집) | 브라우저 API 호출 기록(M4). `trace_id`로 백엔드 트레이스와 연결 |
| `settings` | UI 서버 | `retention_days`(기본 7), `value_max_bytes`(기본 65536) 등 |

## 동시성

- WAL 모드 + `busy_timeout=5000` + 배치 트랜잭션 쓰기 (여러 프로세스 동시 접근 안전)
- 쓰기 병목 시 대비: 추적기의 writer는 인터페이스로 분리되어 있어 "UI 서버로 HTTP 전송(단일 작성자)" 방식으로 교체 가능 (PRD 5절)
