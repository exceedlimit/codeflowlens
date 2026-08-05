// 개요: 코드맵 재스캔 실행기 테스트 — 스캔 명령 자동 탐지와 실행/동시성 제어를 검증한다.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ScanRunner, detectScanners } from "../src/server/scanner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flowlens-scanner-"));
});

function writeConfig(languages: string[]) {
  mkdirSync(join(root, ".flowlens"), { recursive: true });
  writeFileSync(
    join(root, ".flowlens", "config.toml"),
    `languages = [${languages.map((l) => `"${l}"`).join(", ")}]\n`,
  );
}

/** 개요: 실행 가능한 가짜 스캔 명령 스크립트를 만든다. */
function fakeScanScript(name: string, body: string): string {
  const p = join(root, name);
  writeFileSync(p, body);
  return p;
}

describe("detectScanners", () => {
  it("프로젝트 가상환경의 flowlens를 찾는다", () => {
    writeConfig(["python"]);
    mkdirSync(join(root, ".venv", "bin"), { recursive: true });
    const bin = join(root, ".venv", "bin", "flowlens");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);

    const found = detectScanners(root, { commandExists: () => false });
    expect(found).toEqual([{ label: "python", cmd: bin, args: ["scan"] }]);
  });

  it("가상환경이 없으면 PATH의 flowlens를 쓴다", () => {
    writeConfig(["python"]);
    const found = detectScanners(root, { commandExists: (c) => c === "flowlens" });
    expect(found).toEqual([{ label: "python", cmd: "flowlens", args: ["scan"] }]);
  });

  it("node_modules에 설치된 @flowlens/node를 찾는다", () => {
    writeConfig(["node"]);
    const cli = join(root, "node_modules", "@flowlens", "node", "dist", "cli.js");
    mkdirSync(join(root, "node_modules", "@flowlens", "node", "dist"), { recursive: true });
    writeFileSync(cli, "");

    const found = detectScanners(root, { commandExists: () => false });
    expect(found).toEqual([
      { label: "node", cmd: process.execPath, args: [cli, "scan"] },
    ]);
  });

  it("풀스택이면 두 스캐너를 모두 돌린다", () => {
    writeConfig(["python", "node", "browser"]);
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    const nodeBin = join(root, "node_modules", ".bin", "flowlens");
    writeFileSync(nodeBin, "");
    const found = detectScanners(root, { commandExists: (c) => c === "flowlens" });
    expect(found.map((f) => f.label)).toEqual(["python", "node"]);
  });

  it("config.toml이 없으면 프로젝트 파일로 언어를 추정한다", () => {
    writeFileSync(join(root, "pyproject.toml"), "");
    const found = detectScanners(root, { commandExists: (c) => c === "flowlens" });
    expect(found.map((f) => f.label)).toEqual(["python"]);
  });

  it("찾을 수 없으면 빈 목록", () => {
    writeConfig(["python", "node"]);
    expect(detectScanners(root, { commandExists: () => false })).toEqual([]);
  });

  it("override가 있으면 그것만 쓴다", () => {
    writeConfig(["python"]);
    const found = detectScanners(root, {
      override: "/opt/bin/flowlens scan",
      commandExists: () => true,
    });
    expect(found).toEqual([
      { label: "custom", cmd: "/opt/bin/flowlens", args: ["scan"] },
    ]);
  });
});

describe("ScanRunner", () => {
  it("스캔을 실행하고 결과 메시지와 시각을 남긴다", async () => {
    const script = fakeScanScript(
      "ok-scan.js",
      "console.log('스캔 완료: 함수 3개 (주석 있음 3개, 커버리지 100%), 엔티티 1개')",
    );
    const runner = new ScanRunner(root, () => [
      { label: "python", cmd: process.execPath, args: [script] },
    ]);
    expect(runner.status().lastScanAt).toBeNull();

    const result = await runner.run();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("함수 3개");
    expect(runner.status().lastScanAt).toBeGreaterThan(0);
    expect(runner.status().scanning).toBe(false);
  });

  it("스캔 명령이 없으면 안내 메시지를 준다", async () => {
    const runner = new ScanRunner(root, () => []);
    const result = await runner.run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("flowlens scan");
  });

  it("실패한 스캔은 ok=false와 오류 내용을 준다", async () => {
    const script = fakeScanScript(
      "bad-scan.js",
      "console.error('boom'); process.exit(1)",
    );
    const runner = new ScanRunner(root, () => [
      { label: "python", cmd: process.execPath, args: [script] },
    ]);
    const result = await runner.run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("boom");
  });

  it("이미 실행 중이면 중복 실행하지 않는다", async () => {
    const logPath = join(root, "runs.log");
    const script = fakeScanScript(
      "slow-scan.js",
      `require("node:fs").appendFileSync(${JSON.stringify(logPath)}, "x");\n` +
        "setTimeout(() => console.log('스캔 완료'), 150)",
    );
    const runner = new ScanRunner(root, () => [
      { label: "python", cmd: process.execPath, args: [script] },
    ]);
    const [first, second] = await Promise.all([runner.run(), runner.run()]);
    expect([first.skipped, second.skipped].filter(Boolean)).toHaveLength(1);
    expect(readFileSync(logPath, "utf-8")).toBe("x"); // 프로세스는 한 번만 떴다
  });

  it("여러 스캐너를 순서대로 모두 돌린다", async () => {
    const a = fakeScanScript("a.js", "console.log('python 완료')");
    const b = fakeScanScript("b.js", "console.log('node 완료')");
    const runner = new ScanRunner(root, () => [
      { label: "python", cmd: process.execPath, args: [a] },
      { label: "node", cmd: process.execPath, args: [b] },
    ]);
    const result = await runner.run();
    expect(result.ok).toBe(true);
    expect(result.ran.map((r) => r.label)).toEqual(["python", "node"]);
    expect(result.message).toContain("python 완료");
    expect(result.message).toContain("node 완료");
  });
});
