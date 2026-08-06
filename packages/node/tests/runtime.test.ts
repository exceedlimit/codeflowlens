// 개요: 런타임 테스트 — wrap의 부모 추적(동기/async)과 예외 처리를 검증한다.
import { describe, expect, it } from "vitest";

import { FlowlensRuntime } from "../src/runtime.js";
import type { BatchWriter, SpanRow, TraceRow } from "../src/writer.js";

/** 개요: DB 없이 기록만 모으는 가짜 writer. */
function fakeWriter() {
  const spans: SpanRow[] = [];
  const traces: TraceRow[] = [];
  const edges: [string, string][] = [];
  const ends: { id: string; status: string }[] = [];
  const w = {
    traceStart: (r: TraceRow) => { traces.push(r); },
    spanFinish: (r: SpanRow) => { spans.push(r); },
    traceEnd: (id: string, _at: number, status: string) => { ends.push({ id, status }); },
    runtimeEdge: (a: string, b: string) => { edges.push([a, b]); },
    close: () => {},
    flush: () => {},
  };
  return { w: w as unknown as BatchWriter, spans, traces, edges, ends };
}

function makeRuntime(opts?: { excluded?: string[] }) {
  const fake = fakeWriter();
  const rt = new FlowlensRuntime({
    writer: fake.w,
    entryName: "test",
    exclusions: opts?.excluded
      ? { isExcluded: (n: string) => opts.excluded!.includes(n) }
      : undefined,
  });
  return { rt, ...fake };
}

describe("FlowlensRuntime.wrap", () => {
  it("동기 중첩 호출의 부모-자식이 정확하다", () => {
    const { rt, spans, edges } = makeRuntime();
    const inner = () => rt.wrap("a.ts::inner", "inner", { x: 1 }, () => 42);
    const outer = () => rt.wrap("a.ts::outer", "outer", {}, () => inner());
    expect(outer()).toBe(42);
    const o = spans.find((s) => s.name === "outer")!;
    const i = spans.find((s) => s.name === "inner")!;
    expect(i.parent_id).toBe(o.id);
    expect(o.parent_id).toBeNull();
    expect(JSON.parse(i.args_json!)).toEqual({ x: 1 });
    expect(JSON.parse(o.return_json!)).toBe(42);
    expect(edges).toContainEqual(["a.ts::outer", "a.ts::inner"]);
  });

  it("await를 건너도 부모가 정확하다", async () => {
    const { rt, spans } = makeRuntime();
    const leaf = () => rt.wrap("a.ts::leaf", "leaf", {}, () => 7);
    const child = () =>
      rt.wrap("a.ts::child", "child", {}, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return leaf(); // await 뒤 호출 — 부모가 child여야 한다
      });
    const parent = () =>
      rt.wrap("a.ts::parent", "parent", {}, async () => {
        const v = await child();
        const w2 = leaf(); // child 완료 후 호출 — 부모가 parent여야 한다
        return (v as number) + w2;
      });
    expect(await parent()).toBe(14);
    const p = spans.find((s) => s.name === "parent")!;
    const c = spans.find((s) => s.name === "child")!;
    const leaves = spans.filter((s) => s.name === "leaf");
    expect(c.parent_id).toBe(p.id);
    expect(leaves.map((l) => l.parent_id).sort()).toEqual([c.id, p.id].sort());
    expect(c.status).toBe("ok");
    expect(JSON.parse(c.return_json!)).toBe(7);
  });

  it("동시 실행돼도 각자 부모를 유지한다", async () => {
    const { rt, spans } = makeRuntime();
    const leaf = (n: number) => rt.wrap("a.ts::leaf", "leaf", { n }, () => n);
    const task = (n: number) =>
      rt.wrap(`a.ts::task${n}`, `task${n}`, {}, async () => {
        await new Promise((r) => setTimeout(r, n * 3));
        return leaf(n);
      });
    await Promise.all([task(1), task(2)]);
    const t1 = spans.find((s) => s.name === "task1")!;
    const t2 = spans.find((s) => s.name === "task2")!;
    const l1 = spans.find((s) => s.name === "leaf" && JSON.parse(s.args_json!).n === 1)!;
    const l2 = spans.find((s) => s.name === "leaf" && JSON.parse(s.args_json!).n === 2)!;
    expect(l1.parent_id).toBe(t1.id);
    expect(l2.parent_id).toBe(t2.id);
  });

  it("예외는 error 스팬으로 기록되고 그대로 다시 던져진다", () => {
    const { rt, spans } = makeRuntime();
    const boom = () =>
      rt.wrap("a.ts::boom", "boom", {}, () => { throw new Error("bad"); });
    expect(boom).toThrow("bad");
    const b = spans.find((s) => s.name === "boom")!;
    expect(b.status).toBe("error");
    expect(JSON.parse(b.error_json!).message).toBe("bad");
  });

  it("runInTrace 안의 스팬은 그 트레이스에 담긴다", () => {
    const { rt, spans } = makeRuntime();
    rt.runInTrace("req-1", () => rt.wrap("a.ts::h", "h", {}, () => 1));
    expect(spans[0].trace_id).toBe("req-1");
    expect(spans[0].parent_id).toBeNull();
  });
});

// 개요: 웹소켓·타이머처럼 http를 거치지 않는 외부 이벤트 호출을 별도 트레이스로 승격하는 규칙.
// 로직: "이미 끝난 스팬의 컨텍스트"에서 시작된 루트 호출(부모가 종료됨)이 이벤트 진입점이다.
describe("외부 이벤트 진입점 승격", () => {
  it("끝난 스팬의 컨텍스트에서 나중에 실행된 콜백은 새 event 트레이스가 된다", async () => {
    const { rt, spans, traces, ends } = makeRuntime();
    // 서버 기동: start()가 소켓 콜백을 등록하고 즉시 끝난다 (슬랙 socketMode와 동일 구조)
    rt.wrap("bot.ts::start", "start", {}, () => {
      setTimeout(() => {
        rt.wrap("bot.ts::onMessage", "onMessage", {}, () =>
          rt.wrap("bot.ts::reply", "reply", {}, () => "답장"),
        );
      }, 10);
    });
    await new Promise((r) => setTimeout(r, 40));

    const evt = traces.find((t) => t.entry_kind === "event");
    expect(evt).toBeDefined();
    expect(evt!.entry_name).toBe("onMessage");
    const root = spans.find((s) => s.name === "onMessage")!;
    const child = spans.find((s) => s.name === "reply")!;
    expect(root.trace_id).toBe(evt!.id);
    expect(root.parent_id).toBeNull(); // 이벤트 트레이스의 루트
    expect(child.trace_id).toBe(evt!.id);
    expect(child.parent_id).toBe(root.id);
    // start는 여전히 프로세스 트레이스
    expect(spans.find((s) => s.name === "start")!.trace_id).toBe(rt.processTraceId);
    // 루트가 끝나면 트레이스도 닫힌다
    expect(ends).toContainEqual({ id: evt!.id, status: "ok" });
  });

  it("이벤트마다 각각의 트레이스가 생긴다", async () => {
    const { rt, traces } = makeRuntime();
    rt.wrap("bot.ts::start", "start", {}, () => {
      for (const d of [5, 15]) {
        setTimeout(() => rt.wrap("bot.ts::onMessage", "onMessage", {}, () => d), d);
      }
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(traces.filter((t) => t.entry_kind === "event")).toHaveLength(2);
  });

  it("살아있는 부모의 자식 호출은 승격되지 않는다 (기존 동작 유지)", () => {
    const { rt, spans, traces } = makeRuntime();
    rt.wrap("a.ts::outer", "outer", {}, () => rt.wrap("a.ts::inner", "inner", {}, () => 1));
    expect(traces.filter((t) => t.entry_kind === "event")).toHaveLength(0);
    expect(spans.every((s) => s.trace_id === rt.processTraceId)).toBe(true);
  });

  it("이벤트 루트가 예외로 끝나면 트레이스도 error로 닫힌다", async () => {
    const { rt, ends, traces } = makeRuntime();
    rt.wrap("bot.ts::start", "start", {}, () => {
      setTimeout(() => {
        try {
          rt.wrap("bot.ts::onMessage", "onMessage", {}, () => { throw new Error("bad"); });
        } catch { /* 앱이 삼킨 셈 */ }
      }, 5);
    });
    await new Promise((r) => setTimeout(r, 30));
    const evt = traces.find((t) => t.entry_kind === "event")!;
    expect(ends).toContainEqual({ id: evt.id, status: "error" });
  });

  it("추적 제외된 이벤트 진입점은 흐름 전체가 기록되지 않는다", async () => {
    const { rt, spans, traces } = makeRuntime({ excluded: ["onMessage"] });
    let ran = false;
    rt.wrap("bot.ts::start", "start", {}, () => {
      setTimeout(() => {
        rt.wrap("bot.ts::onMessage", "onMessage", {}, () =>
          rt.wrap("bot.ts::reply", "reply", {}, () => { ran = true; }),
        );
      }, 5);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toBe(true); // 앱 코드는 그대로 실행
    expect(traces.filter((t) => t.entry_kind === "event")).toHaveLength(0);
    expect(spans.find((s) => s.name === "onMessage")).toBeUndefined();
    expect(spans.find((s) => s.name === "reply")).toBeUndefined();
  });
});
