#!/usr/bin/env node
// 개요: flowlens CLI (Node) — run(추적 실행) / scan(TS 정적 분석) / check(주석 룰 검사).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_MARKERS = ["package.json", ".git", "pyproject.toml", "requirements.txt"];

/** 개요: 현재 위치에서 위로 올라가며 프로젝트 루트를 찾는다. */
export function findProjectRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (ROOT_MARKERS.some((m) => existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

function runCommand(argv: string[]): void {
  if (argv.length === 0) {
    console.error("사용법: flowlens run <명령> [인자...]");
    process.exit(2);
  }
  const root = findProjectRoot();
  const registerUrl = pathToFileURL(
    fileURLToPath(new URL("./register.mjs", import.meta.url)),
  ).href;
  const nodeOptions = [process.env.NODE_OPTIONS, `--import ${registerUrl}`]
    .filter(Boolean)
    .join(" ");
  const child = spawn(argv[0], argv.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      FLOWLENS_ENABLED: "1",
      FLOWLENS_DB: path.join(root, ".flowlens", "data.db"),
      FLOWLENS_PROJECT_ROOT: root,
      NODE_OPTIONS: nodeOptions,
    },
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(
      "flowlens (Node) — 바이브코딩 모니터링\n\n" +
        "사용법:\n" +
        "  flowlens run <명령> [인자...]   명령을 추적 상태로 실행 (예: flowlens run node server.mjs)\n" +
        "  flowlens scan                   TS/JS 코드를 정적 분석해 코드맵 갱신\n" +
        "  flowlens check [--json]         주석 룰 준수 검사 (위반 시 종료코드 1)\n",
    );
    return;
  }
  if (cmd === "run") return runCommand(rest);
  if (cmd === "scan") {
    const { runScan } = await import("./analyzer/scan-cli.js");
    return runScan(findProjectRoot());
  }
  if (cmd === "check") {
    const { runCheck } = await import("./analyzer/scan-cli.js");
    process.exit(runCheck(findProjectRoot(), rest.includes("--json")));
  }
  console.error(`알 수 없는 명령: ${cmd} (flowlens --help 참고)`);
  process.exit(2);
}

main();
