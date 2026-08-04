// 개요: 계측 대상 필터 테스트.
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";

import { CodeFilter } from "../src/filter.js";

const ROOT = "/tmp/proj";
const f = new CodeFilter(ROOT);

describe("CodeFilter", () => {
  it("프로젝트 하위 소스는 대상", () => {
    expect(f.shouldInstrument(`${ROOT}/src/app.ts`)).toBe(true);
    expect(f.shouldInstrument(pathToFileURL(`${ROOT}/server.mjs`).href)).toBe(true);
  });

  it("node_modules/dist/숨김 폴더는 제외", () => {
    expect(f.shouldInstrument(`${ROOT}/node_modules/x/i.js`)).toBe(false);
    expect(f.shouldInstrument(`${ROOT}/dist/out.js`)).toBe(false);
    expect(f.shouldInstrument(`${ROOT}/.next/x.js`)).toBe(false);
  });

  it("루트 밖·node: 스킴·지원 안 하는 확장자는 제외", () => {
    expect(f.shouldInstrument("/other/app.js")).toBe(false);
    expect(f.shouldInstrument("node:http")).toBe(false);
    expect(f.shouldInstrument(`${ROOT}/data.json`)).toBe(false);
  });

  it("relPath는 루트 기준 상대경로", () => {
    expect(f.relPath(`${ROOT}/src/app.ts`)).toBe("src/app.ts");
  });
});
