// 개요: 바벨 계측 변환 테스트 — 변환된 코드를 실제 런타임으로 실행해 스팬 트리를 검증한다.
import { afterEach, describe, expect, it } from "vitest";

import { instrument } from "../src/instrument.js";
import { CodeflowlensRuntime } from "../src/runtime.js";
import type { BatchWriter, SpanRow, TraceRow } from "../src/writer.js";

const SAMPLE = `
function inner(x, y) { return x + y }
function outer(n) { let t = 0; for (let i = 0; i < 2; i++) t = inner(t, n); return t }
const arrow = (a) => a * 2
class Svc {
  run(v) { return arrow(v) + outer(v) }
}
async function fetchData(q) {
  await new Promise((r) => setTimeout(r, 1))
  return inner(q, 1)
}
function* gen() { yield 1 }
globalThis.__syncResult = new Svc().run(5)
globalThis.__genResult = [...gen()]
globalThis.__asyncPromise = fetchData(3)
`;

function fakeRuntime() {
  const spans: SpanRow[] = [];
  const w = {
    traceStart: (_r: TraceRow) => {},
    spanFinish: (r: SpanRow) => { spans.push(r); },
    traceEnd: () => {}, runtimeEdge: () => {}, close: () => {}, flush: () => {},
  } as unknown as BatchWriter;
  const rt = new CodeflowlensRuntime({ writer: w, entryName: "test" });
  return { rt, spans };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__codeflowlens;
});

describe("instrument", () => {
  it("함수선언/화살표/메서드/async가 계측되어 스팬 트리가 정확하다", async () => {
    const out = instrument(SAMPLE, "a.ts");
    expect(out).toBeTruthy();
    expect(out!).toContain("__codeflowlens");

    const { rt, spans } = fakeRuntime();
    (globalThis as Record<string, unknown>).__codeflowlens = rt;
    new Function(out!)();
    await (globalThis as Record<string, unknown> & { __asyncPromise: Promise<number> }).__asyncPromise;

    expect((globalThis as Record<string, unknown>).__syncResult).toBe(20); // 5*2 + 5+5
    const names = spans.map((s) => s.name);
    expect(names).toContain("outer");
    expect(names).toContain("arrow");
    expect(names).toContain("Svc.run");
    expect(names).toContain("fetchData");
    expect(names).not.toContain("gen"); // 제너레이터는 미계측

    const run = spans.find((s) => s.name === "Svc.run")!;
    const outer = spans.find((s) => s.name === "outer")!;
    expect(outer.parent_id).toBe(run.id);
    expect(run.function_id).toBe("a.ts::Svc.run");
    // async: await 뒤 호출된 inner의 부모가 fetchData
    const fd = spans.find((s) => s.name === "fetchData")!;
    const fdInner = spans.filter((s) => s.name === "inner").find((s) => s.parent_id === fd.id);
    expect(fdInner).toBeTruthy();
    expect(JSON.parse(fd.return_json!)).toBe(4);
    expect(JSON.parse(fd.args_json!)).toEqual({ q: 3 });
  });

  it("런타임이 없으면 원래대로 동작한다(가드)", () => {
    const out = instrument("function f(x){ return x + 1 }\nglobalThis.__r = f(1)", "b.ts");
    new Function(out!)();
    expect((globalThis as Record<string, unknown>).__r).toBe(2);
  });

  it("파싱 실패 소스는 null(원본 사용 신호)", () => {
    expect(instrument("function broken(((", "c.ts")).toBeNull();
  });

  it("이미 계측된 소스는 다시 계측하지 않는다", () => {
    const once = instrument("function f(){return 1}", "d.ts")!;
    expect(instrument(once, "d.ts")).toBe(once);
  });

  it("예외를 던지는 함수도 계측 후 정상 전파된다", () => {
    const out = instrument(
      "function boom(){ throw new Error('bad') }\ntry { boom() } catch (e) { globalThis.__err = e.message }",
      "e.ts",
    );
    const { rt, spans } = fakeRuntime();
    (globalThis as Record<string, unknown>).__codeflowlens = rt;
    new Function(out!)();
    expect((globalThis as Record<string, unknown>).__err).toBe("bad");
    expect(spans.find((s) => s.name === "boom")!.status).toBe("error");
  });
});
