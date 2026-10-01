// 개요: Vite 플러그인 테스트 — 개발 모드 스크립트 주입을 검증한다.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { codeflowlensDev } from "../src/vite-plugin.js";

function makeScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "codeflowlens-vp-"));
  const p = join(dir, "browser.global.js");
  writeFileSync(p, "console.log('codeflowlens-browser')");
  return p;
}

describe("codeflowlensDev", () => {
  it("dev 서버 전용이고 스크립트를 head에 인라인 주입한다", () => {
    const plugin = codeflowlensDev({ scriptPath: makeScript() });
    expect(plugin.apply).toBe("serve");
    const tags = plugin.transformIndexHtml() as {
      tag: string; children: string; injectTo: string;
    }[];
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe("script");
    expect(tags[0].injectTo).toBe("head-prepend");
    expect(tags[0].children).toContain("__CODEFLOWLENS_AUTO__");
    expect(tags[0].children).toContain("codeflowlens-browser");
  });

  it("endpoint 옵션이 반영된다", () => {
    const plugin = codeflowlensDev({
      scriptPath: makeScript(),
      endpoint: "http://127.0.0.1:9999/api/client-events",
    });
    const tags = plugin.transformIndexHtml() as { children: string }[];
    expect(tags[0].children).toContain("http://127.0.0.1:9999/api/client-events");
  });

  it("스크립트 파일이 없으면 아무것도 주입하지 않는다(fail-open)", () => {
    const plugin = codeflowlensDev({ scriptPath: "/no/such/file.js" });
    expect(plugin.transformIndexHtml()).toEqual([]);
  });
});
