// 개요: `@flowlens/node/vite`의 타입 선언 — 에디터/tsc가 플러그인 시그니처를 알게 한다.
// 참고: 손으로 관리하는 파일. src/vite-plugin.ts의 공개 시그니처가 바뀌면 여기도 갱신할 것.
export interface FlowlensDevOptions {
  /** 수집 엔드포인트 (기본 http://127.0.0.1:7411/api/client-events) */
  endpoint?: string;
  /** 테스트용: 주입할 스크립트 파일 경로 재정의 */
  scriptPath?: string;
}

export interface FlowlensHtmlTag {
  tag: string;
  children: string;
  injectTo: "head-prepend";
}

/**
 * 개요: FlowLens 개발용 Vite 플러그인 — 개발 모드에서만 브라우저 API 호출 기록 스크립트를 주입한다.
 */
export declare function flowlensDev(options?: FlowlensDevOptions): {
  name: string;
  apply: "serve";
  transformIndexHtml(): FlowlensHtmlTag[];
};
