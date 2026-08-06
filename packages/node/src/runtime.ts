// 개요: 계측 코드가 호출하는 추적 런타임 — 스팬 조립과 async 부모 추적.
// 로직: wrap()이 AsyncLocalStorage.run(span, body)으로 본문을 실행한다. ALS 컨텍스트는
//       "async 작업이 시작된 시점"에 캡처되므로 await를 건너도 부모가 정확하다.
// 참고: 모든 경로가 fail-open — 추적 실패는 사용자 코드에 영향을 주지 않는다.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { serializeArgs, serializeValue } from "./serialize.js";
import type { BatchWriter } from "./writer.js";

interface Span {
  id: string;
  traceId: string;
  parentId: string | null;
  functionId: string;
  name: string;
  startedAt: number;
  seq: number;
  finished?: boolean; // 종료된 스팬의 컨텍스트에서 오는 호출(이벤트 콜백) 판별용
  eventRoot?: boolean; // 이벤트 트레이스의 루트 — 끝나면 트레이스도 닫는다
}

export interface RuntimeOptions {
  writer: BatchWriter;
  entryName: string;
  maxBytes?: number;
  /** "이 진입점은 추적 안 함" 목록 — 이벤트 진입점 이름도 여기로 거른다 */
  exclusions?: { isExcluded(entryName: string): boolean };
}

const als = new AsyncLocalStorage<Span>();

// 추적 제외 진입점의 요청 동안 쓰이는 트레이스 표식 — 이 흐름의 스팬은 기록하지 않는다
const DISCARD_TRACE = "__flowlens_discard__";

export class FlowlensRuntime {
  private writer: BatchWriter;
  private maxBytes: number;
  private exclusions?: { isExcluded(entryName: string): boolean };
  private seq = 0;
  /** 프로세스 기본 트레이스 id (http 요청 밖의 호출이 담긴다) */
  readonly processTraceId: string;
  /** http 훅이 요청 트레이스를 열 때 als.run에 쓸 스팬 없는 루트 컨텍스트 */
  makeTraceRoot(traceId: string): Span {
    return {
      id: "", traceId, parentId: null, functionId: "", name: "",
      startedAt: 0, seq: -1,
    };
  }

  constructor(opts: RuntimeOptions) {
    this.writer = opts.writer;
    this.maxBytes = opts.maxBytes ?? 65536;
    this.exclusions = opts.exclusions;
    this.processTraceId = randomUUID().replace(/-/g, "");
    this.writer.traceStart({
      id: this.processTraceId,
      started_at: Date.now() / 1000,
      entry_kind: "process",
      entry_name: opts.entryName,
      service: "node",
    });
    // 참고: writer의 close(exit 훅)보다 먼저 실행돼야 종료 상태가 기록된다
    process.prependOnceListener("exit", () => {
      this.writer.traceEnd(this.processTraceId, Date.now() / 1000, "ok");
    });
  }

  /** 개요: http 훅 등이 현재 컨텍스트를 새 트레이스로 바꿔 body를 실행할 때 쓴다. */
  runInTrace<T>(traceId: string, body: () => T): T {
    return als.run(this.makeTraceRoot(traceId), body);
  }

  /** 개요: 추적 제외 요청 — 이 흐름의 스팬을 전혀 기록하지 않고 body만 실행한다. */
  runSuppressed<T>(body: () => T): T {
    return als.run(this.makeTraceRoot(DISCARD_TRACE), body);
  }

  /**
   * 개요: 계측된 함수 본문의 실행을 스팬으로 감싼다 (변환기가 삽입하는 호출).
   * 로직: 부모=현재 ALS 스팬 → 새 스팬을 컨텍스트로 body 실행 → 동기/Promise 완료 시 기록.
   *       프로세스 트레이스 소속인데 부모 스팬이 이미 끝난 호출은 외부 이벤트(웹소켓·타이머
   *       콜백)의 시작이므로 새 'event' 트레이스로 승격한다 — 슬랙 봇처럼 http를 거치지
   *       않는 진입점도 요청처럼 트레이스 1건이 된다.
   */
  wrap(functionId: string, name: string, args: Record<string, unknown>, body: () => unknown): unknown {
    let span: Span | null = null;
    let discard = false;
    try {
      const parent = als.getStore();
      if (parent?.traceId === DISCARD_TRACE) {
        return body(); // 추적 제외 요청 — 기록 없이 실행만
      }
      const isEventRoot =
        parent != null &&
        parent.traceId === this.processTraceId &&
        parent.finished === true;
      if (parent && parent.functionId) {
        this.writer.runtimeEdge(parent.functionId, functionId);
      }
      if (isEventRoot && this.exclusions?.isExcluded(name)) {
        discard = true; // 제외된 이벤트 진입점 — 흐름 전체를 기록하지 않는다
      } else if (isEventRoot) {
        const traceId = randomUUID().replace(/-/g, "");
        const startedAt = Date.now() / 1000;
        this.writer.traceStart({
          id: traceId,
          started_at: startedAt,
          entry_kind: "event",
          entry_name: name,
          service: "node",
        });
        span = {
          id: randomUUID().replace(/-/g, ""),
          traceId,
          parentId: null,
          functionId,
          name,
          startedAt,
          seq: this.seq++,
          eventRoot: true,
        };
      } else {
        span = {
          id: randomUUID().replace(/-/g, ""),
          traceId: parent?.traceId ?? this.processTraceId,
          parentId: parent && parent.id ? parent.id : null,
          functionId,
          name,
          startedAt: Date.now() / 1000,
          seq: this.seq++,
        };
      }
    } catch {
      span = null;
    }
    if (discard) return als.run(this.makeTraceRoot(DISCARD_TRACE), body);
    if (!span) return body();

    const argsJson = safe(() => serializeArgs(args, this.maxBytes)) ?? "{}";
    let result: unknown;
    try {
      result = als.run(span, body);
    } catch (e) {
      this.finish(span, argsJson, "error", null, e);
      throw e;
    }
    if (isThenable(result)) {
      return (result as Promise<unknown>).then(
        (v) => { this.finish(span!, argsJson, "ok", v, null); return v; },
        (e) => { this.finish(span!, argsJson, "error", null, e); throw e; },
      );
    }
    this.finish(span, argsJson, "ok", result, null);
    return result;
  }

  private finish(span: Span, argsJson: string, status: string, retval: unknown, err: unknown): void {
    span.finished = true; // 이후 이 컨텍스트에서 오는 호출은 이벤트 루트로 취급된다
    try {
      this.writer.spanFinish({
        id: span.id,
        trace_id: span.traceId,
        parent_id: span.parentId,
        function_id: span.functionId,
        name: span.name,
        started_at: span.startedAt,
        ended_at: Date.now() / 1000,
        status,
        args_json: argsJson,
        return_json: status === "ok" ? serializeValue(retval, this.maxBytes) : null,
        error_json:
          status === "error"
            ? JSON.stringify({
                type: (err as Error)?.name ?? "Error",
                message: String((err as Error)?.message ?? err).slice(0, 1000),
              })
            : null,
        seq: span.seq,
      });
      if (span.eventRoot) {
        this.writer.traceEnd(span.traceId, Date.now() / 1000, status);
      }
    } catch { /* fail-open */ }
  }
}

function isThenable(v: unknown): boolean {
  return v != null && (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function";
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}
