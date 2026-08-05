// 개요: 코드맵 재스캔 실행기 — 프로젝트에 맞는 flowlens scan 명령을 찾아 실행한다.
// 로직: 언어 설정(.flowlens/config.toml)을 읽어 Python/Node 스캐너를 탐지하고,
//       사용자가 터미널에서 치는 것과 똑같은 명령을 자식 프로세스로 돌린다.
// 참고: 스캔 로직을 UI가 따로 갖지 않고 CLI를 재사용해 결과가 어긋나지 않게 한다.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ScanCommand {
  label: string;
  cmd: string;
  args: string[];
}

export interface DetectOptions {
  /** --scan-cmd 로 지정한 전체 명령(하위 명령 포함). 있으면 이것만 쓴다. */
  override?: string;
  /** 테스트 주입용 — PATH에 명령이 있는지 확인 */
  commandExists?: (cmd: string) => boolean;
}

function defaultCommandExists(cmd: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** 개요: 프로젝트가 어떤 언어를 쓰는지 알아낸다(설정 파일 우선, 없으면 파일로 추정). */
function readLanguages(root: string): string[] {
  try {
    const text = readFileSync(path.join(root, ".flowlens", "config.toml"), "utf-8");
    const m = /languages\s*=\s*\[([^\]]*)\]/.exec(text);
    if (m) return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  } catch {
    /* 설정 없음 — 아래에서 추정 */
  }
  const langs: string[] = [];
  if (["pyproject.toml", "requirements.txt", "setup.py"].some((f) => existsSync(path.join(root, f)))) {
    langs.push("python");
  }
  if (existsSync(path.join(root, "package.json"))) langs.push("node");
  return langs;
}

/** 개요: 이 프로젝트에서 실행할 수 있는 스캔 명령 목록을 찾는다. */
export function detectScanners(root: string, opts: DetectOptions = {}): ScanCommand[] {
  if (opts.override) {
    const parts = opts.override.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      return [{ label: "custom", cmd: parts[0], args: parts.slice(1) }];
    }
  }
  const commandExists = opts.commandExists ?? defaultCommandExists;
  const langs = readLanguages(root);
  const found: ScanCommand[] = [];

  if (langs.includes("python")) {
    const venvBin = [
      path.join(root, ".venv", "bin", "flowlens"),
      path.join(root, "venv", "bin", "flowlens"),
    ].find((p) => existsSync(p));
    if (venvBin) found.push({ label: "python", cmd: venvBin, args: ["scan"] });
    else if (commandExists("flowlens")) {
      found.push({ label: "python", cmd: "flowlens", args: ["scan"] });
    }
  }

  if (langs.some((l) => l === "node" || l === "typescript" || l === "browser")) {
    const localBin = path.join(root, "node_modules", ".bin", "flowlens");
    const directCli = path.join(root, "node_modules", "@flowlens", "node", "dist", "cli.js");
    if (existsSync(localBin)) found.push({ label: "node", cmd: localBin, args: ["scan"] });
    else if (existsSync(directCli)) {
      found.push({ label: "node", cmd: process.execPath, args: [directCli, "scan"] });
    }
  }

  return found;
}

export interface ScanOutcome {
  label: string;
  ok: boolean;
  output: string;
}

export interface ScanRunResult {
  ok: boolean;
  skipped?: boolean;
  ran: ScanOutcome[];
  message: string;
}

export interface ScanStatus {
  scanning: boolean;
  lastScanAt: number | null;
  lastResult: ScanRunResult | null;
  watching: boolean;
  projectRoot: string;
}

const NO_SCANNER_MESSAGE =
  "스캔 명령을 찾을 수 없습니다 — 터미널에서 flowlens scan을 실행하거나, UI 서버를 --scan-cmd 옵션으로 띄우세요";

/** 개요: 재스캔 실행과 상태(진행 중/마지막 결과)를 관리한다. */
export class ScanRunner {
  private running = false;
  private lastScanAt: number | null = null;
  private lastResult: ScanRunResult | null = null;
  watching = false;

  constructor(
    readonly projectRoot: string,
    private detect: () => ScanCommand[],
    private timeoutMs = 180_000,
  ) {}

  status(): ScanStatus {
    return {
      scanning: this.running,
      lastScanAt: this.lastScanAt,
      lastResult: this.lastResult,
      watching: this.watching,
      projectRoot: this.projectRoot,
    };
  }

  /**
   * 개요: 코드맵을 다시 스캔한다.
   * 참고: 이미 실행 중이면 중복 실행하지 않고 skipped를 돌려준다(연속 저장 대비).
   */
  async run(): Promise<ScanRunResult> {
    if (this.running) {
      return { ok: false, skipped: true, ran: [], message: "이미 갱신 중입니다" };
    }
    this.running = true;
    try {
      const scanners = this.detect();
      if (scanners.length === 0) {
        this.lastResult = { ok: false, ran: [], message: NO_SCANNER_MESSAGE };
        return this.lastResult;
      }
      const ran: ScanOutcome[] = [];
      for (const scanner of scanners) {
        ran.push(await this.spawnOne(scanner));
      }
      const ok = ran.every((r) => r.ok);
      const parts = (ok ? ran : ran.filter((r) => !r.ok)).map((r) => r.output).filter(Boolean);
      const result: ScanRunResult = { ok, ran, message: parts.join(" · ") };
      this.lastScanAt = Date.now() / 1000;
      this.lastResult = result;
      return result;
    } catch (e) {
      const result: ScanRunResult = { ok: false, ran: [], message: String(e) };
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  private spawnOne(scanner: ScanCommand): Promise<ScanOutcome> {
    return new Promise((resolve) => {
      let out = "";
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        const lines = out.trim().split("\n").filter(Boolean);
        resolve({ label: scanner.label, ok, output: lines[lines.length - 1] ?? "" });
      };
      try {
        const child = spawn(scanner.cmd, scanner.args, {
          cwd: this.projectRoot,
          env: process.env,
        });
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* 이미 종료 */ }
          out += "\n스캔 시간이 너무 오래 걸려 중단했습니다";
          finish(false);
        }, this.timeoutMs);
        child.stdout?.on("data", (d) => { out += String(d); });
        child.stderr?.on("data", (d) => { out += String(d); });
        child.on("error", (e) => {
          clearTimeout(timer);
          out += String(e.message ?? e);
          finish(false);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          finish(code === 0);
        });
      } catch (e) {
        out += String(e);
        finish(false);
      }
    });
  }
}

/** 개요: DB 경로에서 프로젝트 루트를 유추한다(.flowlens/data.db → 프로젝트 폴더). */
export function inferProjectRoot(dbPath: string): string {
  const dir = path.dirname(path.resolve(dbPath));
  return path.basename(dir) === ".flowlens" ? path.dirname(dir) : dir;
}
