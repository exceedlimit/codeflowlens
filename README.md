# FlowLens (코드네임)

바이브코딩으로 만든 시스템의 **실행 흐름·메서드·엔티티를 사람이 이해할 수 있게** 해주는 모니터링 패키지.
코드를 한 줄도 고치지 않고(log4j처럼 붙이기만 하면) 함수 호출 흐름·파라미터·리턴값을 기록하고, 로컬 웹 UI로 시각화한다.

- 요구사항·설계: [docs/PRD.md](docs/PRD.md)
- 진행 상태: [plans/](plans/) 의 마일스톤 문서 체크박스

## 빠른 시작

```bash
# 0) Node/TS 프로젝트라면 (npm 패키지)
cd packages/node && npm install && npm run build
node dist/cli.js run node server.ts     # 추적 실행 (scan/check도 동일 CLI)

# 1) Python 추적기 설치 (저장소 루트에서)
pip install -e packages/python

# 2) 프로젝트에 이식 — 주석 룰 셋팅 + 첫 정적 분석
cd <내 프로젝트>
flowlens init                        # AGENTS.md 룰, retrofit skill, 코드맵 생성
flowlens check                       # 주석 룰 준수 검사 (기존 코드 소급은 .flowlens/RETROFIT.md 참고)

# 3) 앱을 추적 상태로 실행 — 코드 수정 0
flowlens run uvicorn main:app        # 또는 flowlens run python script.py

# 4) UI 띄우기 (Node 20+)
cd packages/ui && npm install && npm run build
node dist/server/cli.js --db <내 프로젝트>/.flowlens/data.db
# → http://127.0.0.1:7411  (트레이스 / 관계도 / 엔티티)

# 코드가 바뀌면 코드맵 갱신
flowlens scan
```

### 프론트엔드(React/Vite) 연결

vite.config에 플러그인 1줄 — 개발 모드에서만 브라우저 API 호출이 기록되고, 백엔드로 프록시되는 요청은 백엔드 트레이스와 자동 연결된다:

```ts
import { flowlensDev } from "@flowlens/node/vite";
export default defineConfig({
  plugins: [react(), flowlensDev()],
  server: { proxy: { "/orders": "http://127.0.0.1:8300" } }, // 프록시 사용 권장
});
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
