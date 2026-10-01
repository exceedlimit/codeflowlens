# CodeFlowLens

바이브코딩으로 만든 시스템의 **실행 흐름·메서드·엔티티를 사람이 이해할 수 있게** 해주는 모니터링 패키지.
코드를 한 줄도 고치지 않고(log4j처럼 붙이기만 하면) 함수 호출 흐름·파라미터·리턴값을 기록하고, 로컬 웹 UI로 시각화한다.

- 요구사항·설계: [docs/PRD.md](docs/PRD.md)
- 진행 상태: [plans/](plans/) 의 마일스톤 문서 체크박스

> 모든 명령은 축약형 **`cfl`** 로 쓸 수 있다. `cfl` = `codeflowlens`, `cfl-ui` = `codeflowlens-ui`.

## 설치하고 쓰기

```bash
# Python 프로젝트
pip install codeflowlens
# Node/TS 프로젝트 (프로젝트 안에 설치)
npm i -D @codeflowlens/node

cd <내 프로젝트>
cfl init                     # 주석 룰(AGENTS.md)·retrofit skill·코드맵 생성
cfl check                    # 주석 룰 준수 검사 (기존 코드 소급은 .codeflowlens/RETROFIT.md 참고)
cfl run uvicorn main:app     # 앱을 추적 상태로 실행 — 코드 수정 0 (Node: cfl run node server.ts)
npx @codeflowlens/ui         # UI (Node 20+) → http://127.0.0.1:7411  (트레이스 / 관계도 / 엔티티)

# 코드맵 갱신은 자동 — UI 서버가 켜져 있으면 파일 저장을 감지해 다시 스캔한다
# (UI 없이 갱신하려면: cfl scan)
```

## 저장소에서 직접 실행하기 (개발용)

```bash
pip install -e packages/python                           # cfl / codeflowlens 명령 설치
cd packages/node && npm install && npm run build         # Node 추적기
cd packages/ui && npm install && npm run build
node dist/server/cli.js --db <내 프로젝트>/.codeflowlens/data.db
```

### 프론트엔드(React/Vite) 연결

vite.config에 플러그인 1줄 — 개발 모드에서만 브라우저 API 호출이 기록되고, 백엔드로 프록시되는 요청은 백엔드 트레이스와 자동 연결된다:

```ts
import { codeflowlensDev } from "@codeflowlens/node/vite";
export default defineConfig({
  plugins: [react(), codeflowlensDev()],
  server: { proxy: { "/orders": "http://127.0.0.1:8300" } }, // 프록시 사용 권장
});
```

데모로 바로 보기:

```bash
cd examples/fastapi-demo
pip install -r requirements.txt
codeflowlens run uvicorn main:app --port 8000 &
./traffic.sh                          # 트래픽 생성
node ../../packages/ui/dist/server/cli.js --db .codeflowlens/data.db
```

## 구조

| 위치 | 내용 |
|---|---|
| `packages/schema` | 언어 중립 SQLite 스키마 (모든 추적기/UI의 계약) |
| `packages/python` | pip 패키지 `codeflowlens` — Python 추적기(sys.monitoring/settrace) + CLI |
| `packages/node` | npm 패키지 `@codeflowlens/node` — Node 추적기 (M3) |
| `packages/ui` | npm 패키지 `@codeflowlens/ui` — 모니터링 웹 UI (Fastify + React) |
| `examples/` | 데모 앱 (FastAPI 등) |

## 개발

```bash
cd packages/python && .venv/bin/python -m pytest   # Python 테스트
cd packages/ui && npm test                          # UI 테스트
```
