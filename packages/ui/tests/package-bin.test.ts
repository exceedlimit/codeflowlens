// 개요: UI 패키지의 npm 배포 이름과 실행 명령(정식 이름 + 축약 cfl-ui)이 올바르게 등록됐는지 확인한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

describe("package bin", () => {
  it("배포 이름은 @codeflowlens/ui", () => {
    expect(pkg.name).toBe("@codeflowlens/ui");
  });

  it("codeflowlens-ui / cfl-ui 두 명령이 같은 서버를 가리킨다", () => {
    expect(pkg.bin["codeflowlens-ui"]).toBe("dist/server/cli.js");
    expect(pkg.bin["cfl-ui"]).toBe(pkg.bin["codeflowlens-ui"]);
  });
});
