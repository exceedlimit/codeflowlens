# FlowLens (코드네임)

바이브코딩으로 만든 시스템의 **실행 흐름·메서드·엔티티를 사람이 이해할 수 있게** 해주는 모니터링 패키지.
코드를 한 줄도 고치지 않고(log4j처럼 붙이기만 하면) 함수 호출 흐름·파라미터·리턴값을 기록하고, 로컬 웹 UI로 시각화한다.

- 요구사항·설계: [docs/PRD.md](docs/PRD.md)
- 진행 상태: [plans/](plans/) 의 마일스톤 문서 체크박스

## 빠른 시작 (M1 기준)

```bash
# 1) Python 추적기 설치 (저장소 루트에서)
pip install -e packages/python

# 2) 앱을 추적 상태로 실행 — 코드 수정 0
cd <내 프로젝트>
flowlens run uvicorn main:app        # 또는 flowlens run python script.py

# 3) UI 띄우기 (Node 20+)
cd packages/ui && npm install && npm run build
node dist/server/cli.js --db <내 프로젝트>/.flowlens/data.db
# → http://127.0.0.1:7411
```

데모로 바로 보기:

```bash
cd examples/fastapi-demo
pip install -r requirements.txt
flowlens run uvicorn main:app --port 8000 &
./traffic.sh                          # 트래픽 생성
node ../../packages/ui/dist/server/cli.js --db .flowlens/data.db
```

## 구조

| 위치 | 내용 |
|---|---|
| `packages/schema` | 언어 중립 SQLite 스키마 (모든 추적기/UI의 계약) |
| `packages/python` | pip 패키지 `flowlens` — Python 추적기(sys.monitoring/settrace) + CLI |
| `packages/node` | npm 패키지 `@flowlens/node` — Node 추적기 (M3) |
| `packages/ui` | npm 패키지 `@flowlens/ui` — 모니터링 웹 UI (Fastify + React) |
| `examples/` | 데모 앱 (FastAPI 등) |

## 개발

```bash
cd packages/python && .venv/bin/python -m pytest   # Python 테스트
cd packages/ui && npm test                          # UI 테스트
```
