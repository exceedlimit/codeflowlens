// 개요: 브라우저 기록 스크립트 테스트 — fetch 패치/헤더 부착/기록 전송을 가짜 환경에서 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installBrowserTracer } from "../src/browser.js";

interface Sent { url: string; init?: RequestInit }

let sent: Sent[];
let reported: Sent[];
let originalFetch: (url: string, init?: RequestInit) => Promise<Response>;

const ENDPOINT = "http://127.0.0.1:7411/api/client-events";

beforeEach(() => {
  sent = [];
  reported = [];
  originalFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith(ENDPOINT)) {
      reported.push({ url: target, init });
    } else {
      sent.push({ url: target, init });
    }
    if (target.includes("/fail")) throw new TypeError("network down");
    return new Response("{}", { status: target.includes("/409") ? 409 : 200 });
  }) as unknown as typeof originalFetch;

  const g = globalThis as Record<string, unknown>;
  g.window = g; // 스크립트가 window 기준으로 동작
  g.fetch = originalFetch;
  g.location = { href: "http://localhost:5173/orders-page" };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.location;
  delete g.__codeflowlens_browser_installed__;
  // @ts-expect-error 테스트 후 정리
  delete globalThis.fetch;
});

async function flushReports() {
  await new Promise((r) => setTimeout(r, 10));
}

describe("installBrowserTracer", () => {
  it("fetch에 트레이스 헤더를 붙이고 기록을 전송한다", async () => {
    installBrowserTracer({ endpoint: ENDPOINT });
    const res = await (globalThis.fetch as typeof fetch)("/inventory");
    expect(res.status).toBe(200);

    expect(sent).toHaveLength(1);
    const headers = new Headers(sent[0].init?.headers);
    const traceId = headers.get("x-codeflowlens-trace");
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    await flushReports();
    expect(reported).toHaveLength(1);
    const body = JSON.parse(String(reported[0].init?.body));
    expect(body.trace_id).toBe(traceId);
    expect(body.method).toBe("GET");
    expect(body.url).toBe("/inventory");
    expect(body.page_url).toBe("http://localhost:5173/orders-page");
    expect(body.status).toBe(200);
    expect(typeof body.duration_ms).toBe("number");
    // 단순 요청(preflight 없는) 형식이어야 한다
    expect(new Headers(reported[0].init?.headers).get("content-type")).toBe("text/plain");
  });

  it("수집 엔드포인트로 가는 요청은 기록하지 않는다(재귀 방지)", async () => {
    installBrowserTracer({ endpoint: ENDPOINT });
    await (globalThis.fetch as typeof fetch)(ENDPOINT, { method: "POST", body: "x" });
    await flushReports();
    expect(reported.filter((r) => r.init?.method === "POST" && String(r.init?.body).includes("trace_id")))
      .toHaveLength(0);
  });

  it("네트워크 오류는 그대로 전파되고 실패로 기록된다", async () => {
    installBrowserTracer({ endpoint: ENDPOINT });
    await expect((globalThis.fetch as typeof fetch)("/fail")).rejects.toThrow("network down");
    await flushReports();
    const body = JSON.parse(String(reported[0].init?.body));
    expect(body.status).toBeNull();
  });

  it("에러 상태코드도 기록된다", async () => {
    installBrowserTracer({ endpoint: ENDPOINT });
    await (globalThis.fetch as typeof fetch)("/orders/409", { method: "POST" });
    await flushReports();
    const body = JSON.parse(String(reported[0].init?.body));
    expect(body.status).toBe(409);
    expect(body.method).toBe("POST");
  });

  it("두 번 설치해도 한 번만 동작한다", async () => {
    installBrowserTracer({ endpoint: ENDPOINT });
    installBrowserTracer({ endpoint: ENDPOINT });
    await (globalThis.fetch as typeof fetch)("/inventory");
    await flushReports();
    expect(reported).toHaveLength(1);
  });
});
