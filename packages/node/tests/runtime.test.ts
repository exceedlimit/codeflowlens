// 개요: 런타임 테스트 — wrap의 부모 추적(동기/async)과 예외 처리를 검증한다.
import { describe, expect, it } from "vitest";

import { FlowlensRuntime } from "../src/runtime.js";
import type { BatchWriter, SpanRow, TraceRow } from "../src/writer.js";

/** 개요: DB 없이 기록만 모으는 가짜 writer. */
function fakeWriter() {
  const spans: SpanRow[] = [];
  const traces: TraceRow[] = [];
  const edges: [string, string][] = [];
  const w = {
    traceStart: (r: TraceRow) => { traces.push(r); },
    spanFinish: (r: SpanRow) => { spans.push(r); },
    traceEnd: () => {},
    runtimeEdge: (a: string, b: string) => { edges.push([a, b]); },
    close: () => {},
    flush: () => {},
  };
  return { w: w as unknown as BatchWriter, spans, traces, edges };
}

function makeRuntime() {
  const fake = fakeWriter();
  const rt = new FlowlensRuntime({ writer: fake.w, entryName: "test" });
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
