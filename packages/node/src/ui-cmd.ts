// 개요: `cfl ui` — 모니터링 화면(@codeflowlens/ui)을 띄운다.
// 로직: 프로젝트 node_modules에 UI가 설치돼 있으면 그것을, 없으면 npx로 내려받아 실행한다.
//       DB를 지정하지 않았으면 프로젝트의 .codeflowlens/data.db를 넘긴다.
// 참고: UI는 별도 패키지라 추적기(@codeflowlens/node)만 설치한 사용자도 이 명령 하나로 화면을 열 수 있다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const UI_PACKAGE = "@codeflowlens/ui";
const UI_BIN = "codeflowlens-ui";
const IS_WINDOWS = process.platform === "win32";

/** 개요: 모니터링 화면을 띄울 실행 명령과 인자를 만든다. */
export function buildUiCommand(
  projectRoot: string,
  extraArgs: string[],
): { cmd: string; args: string[] } {
  let args = [...extraArgs];
  if (!args.some((a) => a === "--db" || a.startsWith("--db="))) {
    args = ["--db", path.join(projectRoot, ".codeflowlens", "data.db"), ...args];
  }
  const local = path.join(projectRoot, "node_modules", ".bin", IS_WINDOWS ? `${UI_BIN}.cmd` : UI_BIN);
  if (existsSync(local)) return { cmd: local, args };
  return { cmd: IS_WINDOWS ? "npx.cmd" : "npx", args: ["-y", UI_PACKAGE, ...args] };
}

/** 개요: 모니터링 화면을 띄우고, 화면 서버가 끝나면 같은 종료코드로 끝낸다. */
export function runUi(projectRoot: string, extraArgs: string[]): void {
  const { cmd, args } = buildUiCommand(projectRoot, extraArgs);
  const child = spawn(cmd, args, { stdio: "inherit", cwd: projectRoot, shell: IS_WINDOWS });
  child.on("error", () => {
    console.error("모니터링 화면을 띄우지 못했습니다 — Node 22+와 npx가 설치돼 있는지 확인하세요.");
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}
