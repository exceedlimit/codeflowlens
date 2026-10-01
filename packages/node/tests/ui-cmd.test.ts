// 개요: `cfl ui` 명령이 모니터링 화면을 띄울 실행 명령을 올바르게 고르는지 검증한다.
// 로직: 프로젝트에 설치된 UI가 있으면 그것을, 없으면 npx로 @codeflowlens/ui를 실행한다.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildUiCommand } from "../src/ui-cmd.js";

function tempProject(): string {
  return mkdtempSync(path.join(tmpdir(), "codeflowlens-uicmd-"));
}

describe("buildUiCommand", () => {
  it("설치된 UI가 없으면 npx로 실행하고 프로젝트 DB를 넘긴다", () => {
    const root = tempProject();
    const { cmd, args } = buildUiCommand(root, []);
    expect(cmd).toMatch(/^npx(\.cmd)?$/);
    expect(args).toEqual([
      "-y", "@codeflowlens/ui",
      "--db", path.join(root, ".codeflowlens", "data.db"),
    ]);
  });

  it("프로젝트 node_modules에 UI가 있으면 그것을 쓴다", () => {
    const root = tempProject();
    const local = path.join(root, "node_modules", ".bin", "codeflowlens-ui");
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, "");
    expect(buildUiCommand(root, []).cmd).toBe(local);
  });

  it("사용자가 준 --db/--port는 그대로 넘기고 기본 DB를 덧붙이지 않는다", () => {
    const { args } = buildUiCommand(tempProject(), ["--db", "x.db", "--port", "9000"]);
    expect(args.slice(-4)).toEqual(["--db", "x.db", "--port", "9000"]);
    expect(args.filter((a) => a === "--db")).toHaveLength(1);
  });
});
