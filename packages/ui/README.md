# @codeflowlens/ui

CodeFlowLens 모니터링 화면. 추적기가 기록한 `.codeflowlens/data.db`를 읽어 실행 흐름(호출 트리), 메서드·엔티티 관계도, 비즈니스 주석을 로컬 웹 UI로 보여줍니다.

```bash
cd <내 프로젝트>
npx @codeflowlens/ui                       # → http://127.0.0.1:7411
npx @codeflowlens/ui --db path/to/data.db --port 7411
```

`cfl ui`(Python `codeflowlens` 또는 `@codeflowlens/node` 설치 시)로 띄워도 같습니다. 명령 이름은 `codeflowlens-ui`, 축약형 `cfl-ui`.

- 요구 사항: Node 22+
- 화면은 127.0.0.1에서만 열립니다 (외부 노출 없음)
- 자세한 내용: https://github.com/exceedlimit/codeflowlens
