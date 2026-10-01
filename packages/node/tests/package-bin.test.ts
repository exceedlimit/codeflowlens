// 개요: npm 배포 이름과 실행 명령(정식 이름 + 축약 cfl)이 올바르게 등록됐는지 확인한다.
// 참고: codeflowlens 와 cfl 중 어느 쪽을 쳐도 같은 CLI가 실행돼야 한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

describe("package bin", () => {
  it("배포 이름은 @codeflowlens/node", () => {
    expect(pkg.name).toBe("@codeflowlens/node");
  });

  it("codeflowlens / cfl 두 명령이 같은 CLI를 가리킨다", () => {
    expect(pkg.bin.codeflowlens).toBe("dist/cli.js");
    expect(pkg.bin.cfl).toBe(pkg.bin.codeflowlens);
  });
});
