// 개요: 브라우저 API 호출 기록 스크립트 — fetch/XHR을 감싸 트레이스 헤더를 붙이고
//       호출 기록을 수집 엔드포인트로 보낸다(개발 모드 전용, Vite 플러그인이 주입).
// 로직: 요청마다 trace id 생성 → x-codeflowlens-trace 헤더 부착(백엔드가 client_trace_id로 저장)
//       → 완료 시 원본 fetch로 기록 전송(text/plain 단순 요청 — CORS preflight 없음).
// 참고: 수집 서버가 꺼져 있으면 조용히 버린다. 앱 동작에 절대 영향을 주지 않는다(fail-open).

export interface BrowserTracerOptions {
  endpoint?: string;
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:7411/api/client-events";
const FLAG = "__codeflowlens_browser_installed__";

function makeTraceId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
}

export function installBrowserTracer(options: BrowserTracerOptions = {}): void {
  const w = (typeof window !== "undefined" ? window : globalThis) as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const originalFetch = (w.fetch as typeof fetch).bind(w);

  function report(event: Record<string, unknown>): void {
    try {
      originalFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "text/plain" }, // 단순 요청 → preflight 없음
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => { /* 수집 서버 꺼짐 — 무시 */ });
    } catch { /* fail-open */ }
  }

  w.fetch = async function tracedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(endpoint)) {
      return originalFetch(input as RequestInfo, init); // 재귀 방지
    }
    const traceId = makeTraceId();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const started = Date.now();
    const pageUrl = (w.location as { href?: string } | undefined)?.href ?? "";

    let newInit = init;
    try {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-codeflowlens-trace", traceId);
      newInit = { ...init, headers };
    } catch { /* 헤더 부착 실패 시 원본 그대로 */ }

    const base = {
      id: makeTraceId(),
      trace_id: traceId,
      page_url: pageUrl,
      method,
      url,
      started_at: started / 1000,
    };
    try {
      const res = await originalFetch(input as RequestInfo, newInit);
      report({ ...base, duration_ms: Date.now() - started, status: res.status });
      return res;
    } catch (e) {
      report({ ...base, duration_ms: Date.now() - started, status: null });
      throw e;
    }
  };

  // XMLHttpRequest도 동일하게 감싼다 (axios 등 XHR 기반 라이브러리 대응)
  const XHR = w.XMLHttpRequest as (new () => XMLHttpRequest) | undefined;
  if (XHR) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    XHR.prototype.open = function (this: XMLHttpRequest & Record<string, unknown>,
      method: string, url: string | URL, ...rest: unknown[]) {
      this.__codeflowlens_method = String(method).toUpperCase();
      this.__codeflowlens_url = String(url);
      // @ts-expect-error 원형 시그니처 전달
      return origOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function (this: XMLHttpRequest & Record<string, unknown>, body?: unknown) {
      try {
        const url = String(this.__codeflowlens_url ?? "");
        if (!url.startsWith(endpoint)) {
          const traceId = makeTraceId();
          const started = Date.now();
          this.setRequestHeader("x-codeflowlens-trace", traceId);
          this.addEventListener("loadend", () => {
            report({
              id: makeTraceId(),
              trace_id: traceId,
              page_url: (w.location as { href?: string } | undefined)?.href ?? "",
              method: this.__codeflowlens_method ?? "GET",
              url,
              started_at: started / 1000,
              duration_ms: Date.now() - started,
              status: this.status || null,
            });
          });
        }
      } catch { /* fail-open */ }
      return origSend.call(this, body as XMLHttpRequestBodyInit);
    };
  }
}

// 주입 스크립트(iife)로 쓰일 때 자동 설치 — window.__CODEFLOWLENS_ENDPOINT__로 엔드포인트 설정
declare const __CODEFLOWLENS_AUTO__: boolean | undefined;
if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__CODEFLOWLENS_AUTO__) {
  installBrowserTracer({
    endpoint: (window as unknown as Record<string, string>).__CODEFLOWLENS_ENDPOINT__,
  });
}
