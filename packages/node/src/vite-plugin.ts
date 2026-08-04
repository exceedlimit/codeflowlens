// 개요: Vite 플러그인 — 개발 모드에서만 브라우저 기록 스크립트를 index.html에 인라인 주입한다.
// 로직: vite.config에 flowlensDev() 1줄이면 끝. 빌드(운영)에는 절대 포함되지 않는다(apply: serve).
// 참고: 코드 오염 0 원칙의 브라우저 버전 — 앱 소스는 건드리지 않는다(PRD 7절).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface FlowlensDevOptions {
  /** 수집 엔드포인트 (기본 http://127.0.0.1:7411/api/client-events) */
  endpoint?: string;
  /** 테스트용: 주입할 스크립트 파일 경로 재정의 */
  scriptPath?: string;
}

interface HtmlTag {
  tag: string;
  children: string;
  injectTo: "head-prepend";
}

/** 개요: FlowLens 개발용 Vite 플러그인을 만든다. */
export function flowlensDev(options: FlowlensDevOptions = {}) {
  return {
    name: "flowlens-dev",
    apply: "serve" as const,
    transformIndexHtml(): HtmlTag[] {
      try {
        const scriptPath =
          options.scriptPath ??
          fileURLToPath(new URL("./browser.global.js", import.meta.url));
        const code = readFileSync(scriptPath, "utf-8");
        const prelude =
          "window.__FLOWLENS_AUTO__=true;" +
          (options.endpoint
            ? `window.__FLOWLENS_ENDPOINT__=${JSON.stringify(options.endpoint)};`
            : "");
        return [{ tag: "script", children: prelude + code, injectTo: "head-prepend" }];
      } catch {
        return []; // 스크립트 없음(빌드 전 등) — 조용히 건너뜀
      }
    },
  };
}
