# @codeflowlens/node

CodeFlowLens의 Node/TypeScript 추적기. **코드를 한 줄도 고치지 않고** 함수 호출 흐름·파라미터·리턴값을 기록하고, TS/JS 코드를 정적 분석해 메서드·엔티티 관계도를 만듭니다.

```bash
npm i -D @codeflowlens/node

npx cfl run node server.ts     # 추적 상태로 실행 (npm run dev 등 어떤 명령이든 앞에 붙이면 됨)
npx cfl scan                   # 코드맵(관계도) 갱신
npx cfl check                  # 비즈니스 주석 룰 검사
npx cfl ui                     # 모니터링 화면 → http://127.0.0.1:7411
```

`cfl`은 `codeflowlens`의 축약 명령입니다. 기록은 프로젝트의 `.codeflowlens/data.db`(SQLite 한 파일)에 쌓이며 별도 인프라가 필요 없습니다.

## 프론트엔드(React/Vite) 연결

```ts
// vite.config.ts — 개발 모드에서만 브라우저 API 호출을 기록하고 백엔드 트레이스와 연결
import { codeflowlensDev } from "@codeflowlens/node/vite";
export default defineConfig({ plugins: [react(), codeflowlensDev()] });
```

- 요구 사항: Node 22+
- Python 프로젝트는 `pip install codeflowlens`
- 자세한 내용: https://github.com/exceedlimit/codeflowlens
