// 개요: http 요청 1건 = 트레이스 1건 그룹핑 — node:http 서버의 request 이벤트를 감싼다.
// 로직: Server.emit('request')를 가로채 트레이스를 열고, 핸들러 체인을 runInTrace로 실행,
//       응답 finish에서 상태코드와 함께 닫는다. Express/Fastify/Nest 모두 node:http 기반이라 공통 동작.
// 참고: x-codeflowlens-trace 헤더가 있으면 client_trace_id로 저장(M4 프론트 연결용).
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ExclusionCache } from "./exclusions.js";
import type { CodeflowlensRuntime } from "./runtime.js";
import type { BatchWriter } from "./writer.js";

export function installHttpHook(
  runtime: CodeflowlensRuntime,
  writer: BatchWriter,
  exclusions?: ExclusionCache,
): void {
  const originalEmit = http.Server.prototype.emit;

  http.Server.prototype.emit = function (event: string | symbol, ...args: unknown[]): boolean {
    if (event !== "request") {
      return originalEmit.call(this, event, ...args) as boolean;
    }
    try {
      const req = args[0] as IncomingMessage;
      const res = args[1] as ServerResponse;
      const traceId = randomUUID().replace(/-/g, "");
      const method = req.method ?? "GET";
      const urlPath = (req.url ?? "/").split("?")[0];
      // 설정에서 "추적 안 함"으로 지정한 진입점은 트레이스도 스팬도 남기지 않는다
      if (exclusions?.isExcluded(`${method} ${urlPath}`)) {
        return runtime.runSuppressed(() =>
          originalEmit.call(this, event, ...args),
        ) as boolean;
      }
      const header = req.headers["x-codeflowlens-trace"];
      writer.traceStart({
        id: traceId,
        started_at: Date.now() / 1000,
        entry_kind: "http",
        entry_name: `${method} ${urlPath}`,
        http_method: method,
        http_path: urlPath,
        client_trace_id: typeof header === "string" ? header : null,
        service: "node",
      });
      res.once("finish", () => {
        try {
          writer.traceEnd(
            traceId,
            Date.now() / 1000,
            res.statusCode >= 500 ? "error" : "ok",
            res.statusCode,
          );
        } catch { /* fail-open */ }
      });
      return runtime.runInTrace(traceId, () =>
        originalEmit.call(this, event, ...args),
      ) as boolean;
    } catch {
      return originalEmit.call(this, event, ...args) as boolean;
    }
  };
}
