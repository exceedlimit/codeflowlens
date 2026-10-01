// 개요: 배포 버전 관리 스크립트(scripts/version.mjs)를 검증한다.
// 로직: 세 패키지(PyPI 1 + npm 2)의 버전이 항상 같게 유지되는지, set이 한 번에 모두 바꾸는지,
//       check가 태그와 버전 불일치를 잡아내는지 확인한다.
// 참고: 태그 하나로 세 패키지를 함께 배포하므로 버전이 어긋나면 배포가 실패한다.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error — 저장소 루트의 순수 JS 스크립트 (타입 선언 없음)
import { checkVersions, readVersions, setVersion } from "../../../scripts/version.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** 개요: 저장소와 같은 구조의 버전 파일들을 임시 폴더에 만든다. */
function fakeRepo(version: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "codeflowlens-ver-"));
  const pyDir = path.join(root, "packages/python/src/codeflowlens");
  mkdirSync(pyDir, { recursive: true });
  writeFileSync(path.join(pyDir, "_version.py"), `__version__ = "${version}"\n`);
  for (const pkg of ["node", "ui"]) {
    const dir = path.join(root, "packages", pkg);
    mkdirSync(dir, { recursive: true });
    const name = `@codeflowlens/${pkg}`;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }, null, 2) + "\n");
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({ name, version, lockfileVersion: 3, packages: { "": { name, version } } }, null, 2) + "\n",
    );
  }
  return root;
}

describe("release version script", () => {
  it("실제 저장소의 세 패키지 버전이 모두 같다", () => {
    const v = readVersions(REPO_ROOT);
    expect(v.node).toBe(v.python);
    expect(v.ui).toBe(v.python);
  });

  it("set이 세 패키지와 lock 파일 버전을 한 번에 바꾼다", () => {
    const root = fakeRepo("0.1.0");
    setVersion(root, "0.2.0");
    expect(readVersions(root)).toEqual({ python: "0.2.0", node: "0.2.0", ui: "0.2.0" });
    const lock = JSON.parse(readFileSync(path.join(root, "packages/ui/package-lock.json"), "utf-8"));
    expect(lock.version).toBe("0.2.0");
    expect(lock.packages[""].version).toBe("0.2.0");
    expect(checkVersions(root, "v0.2.0")).toEqual([]);
  });

  it("check가 태그와 다른 버전, 패키지 간 불일치를 잡아낸다", () => {
    const root = fakeRepo("0.1.0");
    expect(checkVersions(root, "v0.1.1").length).toBeGreaterThan(0);
    writeFileSync(
      path.join(root, "packages/node/package.json"),
      JSON.stringify({ name: "@codeflowlens/node", version: "0.1.5" }) + "\n",
    );
    expect(checkVersions(root).length).toBeGreaterThan(0);
  });

  it("버전 형식이 틀리면 set을 거부한다", () => {
    expect(() => setVersion(fakeRepo("0.1.0"), "v1.0")).toThrow();
  });
});
