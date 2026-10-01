// 개요: 패키지에 내장된 스키마 사본이 계약 원본(packages/schema)과 동일한지 검증한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("schema sync", () => {
  it("사본 == 원본", () => {
    const original = readFileSync(
      new URL("../../schema/schema.sql", import.meta.url),
      "utf-8",
    );
    const vendored = readFileSync(
      new URL("../src/db/schema.sql", import.meta.url),
      "utf-8",
    );
    expect(vendored).toBe(original);
  });
});

describe("usage guide sync", () => {
  it("Node 패키지의 사용법 안내서 == Python 패키지 원본", () => {
    const original = readFileSync(
      new URL("../../python/src/codeflowlens/templates/usage_guide.md", import.meta.url),
      "utf-8",
    );
    const vendored = readFileSync(
      new URL("../src/templates/usage_guide.md", import.meta.url),
      "utf-8",
    );
    expect(vendored).toBe(original);
  });
});
