// 개요: 소스 파일 감시기 테스트 — 저장 감지·무시 규칙·연속 저장 묶기(디바운스)를 검증한다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startCodeWatcher } from "../src/server/watcher.js";

let root: string;
let stop: (() => void) | null = null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flowlens-watch-"));
});

afterEach(() => {
  stop?.();
  stop = null;
});

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("startCodeWatcher", () => {
  it("소스 파일을 저장하면 알려준다", async () => {
    const calls: number[] = [];
    stop = startCodeWatcher(root, () => calls.push(Date.now()), { debounceMs: 40 });
    await wait(80); // macOS 파일 감시(FSEvents) 초기화가 끝나길 기다린다
    writeFileSync(join(root, "app.py"), "def f(): pass\n");
    await wait(400);
    expect(calls).toHaveLength(1);
  });

  it("연속 저장은 한 번으로 묶는다", async () => {
    const calls: number[] = [];
    stop = startCodeWatcher(root, () => calls.push(Date.now()), { debounceMs: 60 });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, `f${i}.ts`), `export const x${i} = ${i}\n`);
      await wait(10);
    }
    await wait(250);
    expect(calls).toHaveLength(1);
  });

  it("node_modules·.flowlens·빌드 산출물 변경은 무시한다", async () => {
    const calls: number[] = [];
    stop = startCodeWatcher(root, () => calls.push(Date.now()), { debounceMs: 40 });
    for (const dir of ["node_modules", ".flowlens", "dist", "__pycache__", ".venv"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "x.js"), "1");
    }
    await wait(250);
    expect(calls).toHaveLength(0);
  });

  it("소스가 아닌 파일(문서·데이터)은 무시한다", async () => {
    const calls: number[] = [];
    stop = startCodeWatcher(root, () => calls.push(Date.now()), { debounceMs: 40 });
    writeFileSync(join(root, "README.md"), "hi");
    writeFileSync(join(root, "data.json"), "{}");
    await wait(250);
    expect(calls).toHaveLength(0);
  });

  it("감시할 수 없는 경로여도 서버를 죽이지 않는다(fail-open)", () => {
    expect(() => {
      const s = startCodeWatcher("/no/such/path/at/all", () => {}, { debounceMs: 10 });
      s();
    }).not.toThrow();
  });
});
