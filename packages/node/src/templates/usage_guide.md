# FlowLens 사용법

이 파일은 FlowLens가 자동 생성한 안내서입니다. 지워져도 `flowlens init`(또는 run/scan)을 실행하면 다시 생깁니다.

## FlowLens가 하는 일

- 앱을 **코드 수정 없이** 추적해 함수 호출 흐름·파라미터·리턴값을 기록합니다.
- 기록은 이 폴더의 `data.db`(SQLite) 한 파일에 쌓입니다 — 별도 인프라가 필요 없습니다.
- 웹 UI에서 실행 흐름(호출 트리), 메서드/엔티티 관계도, 비즈니스 주석을 봅니다.

## 기본 사용 순서

1. **추적 상태로 실행** — 기존 실행 명령 앞에 `flowlens run`만 붙입니다.

   ```bash
   flowlens run uvicorn main:app        # Python 웹 서버
   flowlens run python script.py        # Python 스크립트
   flowlens run node server.ts          # Node/TS (npm 패키지 @flowlens/node)
   flowlens run npm run dev
   ```

   `flowlens run` 없이 실행하면 추적이 전혀 되지 않습니다(오버헤드 0) — 운영 배포에 안전합니다.

2. **UI 열기**

   ```bash
   npx @flowlens/ui        # 또는 flowlens-ui
   # → http://127.0.0.1:7411 (기본 DB: 현재 폴더의 .flowlens/data.db)
   ```

3. **코드맵 갱신 — 보통은 신경 쓸 필요 없습니다**

   `flowlens init`이 첫 스캔까지 해주고, 그 뒤로는 **UI 서버가 켜져 있는 동안 소스 파일 저장을 감지해 자동으로 다시 스캔**합니다(저장 후 1~2초). UI 상단에 "코드맵 자동 N분 전 갱신"과 **[지금 갱신]** 버튼이 있습니다.

   UI를 안 띄운 채로 갱신하고 싶을 때만 직접 실행하세요:

   ```bash
   flowlens scan
   ```

   > 참고: 스캔은 **설명·관계도·엔티티·커버리지**에만 영향을 줍니다. 실행 흐름(트레이스·호출 트리·파라미터)은 스캔과 무관하게 항상 최신입니다.

## 주석 룰 — UI에 설명이 보이게 하려면

- 함수/메서드: `개요`(필수) · `로직`(필수) · `참고`(선택)
- 엔티티 클래스: `개요`(필수) · `파라미터`(필드 설명, 필수) · `참고`(선택)
- 전체 룰과 예시: **AGENTS.md의 "FlowLens 주석 룰" 섹션**
- 검사: `flowlens check` — 위반 목록 출력, 위반 시 종료코드 1(CI 연동 가능)
- 기존 코드에 소급하려면 코딩 에이전트에게: **"flowlens-retrofit 스킬로 주석 소급 작업해줘"** (절차: `.flowlens/RETROFIT.md`)

## 프론트엔드(React/Vite) 연결

`vite.config.ts`에 한 줄이면 개발 모드에서 브라우저 API 호출이 기록되고 백엔드 트레이스와 연결됩니다:

```ts
import { flowlensDev } from "@flowlens/node/vite";
export default defineConfig({
  plugins: [react(), flowlensDev()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } }, // 프록시 사용 권장
});
```

UI에서 🌐 표시로 "화면의 어떤 동작 → 백엔드의 어떤 흐름"이 이어져 보입니다.

## 데이터 관리

- 실행 기록은 기본 **7일** 뒤 자동 삭제됩니다(UI 설정 화면에서 변경). 코드맵(함수·주석·관계도)은 유지됩니다.
- 파라미터/리턴값은 값 1개당 기본 64KB까지 저장(초과분은 잘림, 설정 가능).
- `.flowlens/` 폴더는 커밋하지 않습니다(.gitignore에 자동 추가됨).

## 잘 안 될 때

| 증상 | 확인할 것 |
|---|---|
| 트레이스가 안 보임 | `flowlens run`으로 실행했는지 · UI의 DB 경로(`--db`)가 이 프로젝트의 `.flowlens/data.db`인지 |
| 함수 설명이 "주석 없음" | 주석이 룰 형식(개요/로직/참고)인지 · UI의 [지금 갱신] 클릭 |
| 관계도/엔티티가 비어 있음 | `flowlens scan` 실행(또는 UI의 [지금 갱신]) |
| 코드를 고쳤는데 관계도가 그대로 | UI 상단 갱신 시각 확인 · 자동 감지가 "켬"인지(안 되면 [지금 갱신]) · UI 서버를 프로젝트 폴더에서 띄웠는지 |
| 프론트 연결(🌐)이 안 보임 | Vite 플러그인 추가 여부 · 백엔드 요청이 프록시를 지나는지 · UI 서버(7411)가 떠 있는지 |
