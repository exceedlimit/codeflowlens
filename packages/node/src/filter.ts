// 개요: "내 프로젝트 코드만 계측"을 판정하는 필터 (파이썬 CodeFilter와 동일 규칙).
// 참고: macOS의 /var → /private/var 같은 심볼릭 링크 때문에 루트/파일 모두 realpath로 정규화한다.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const EXCLUDED_DIR_NAMES = new Set([
  "node_modules", ".venv", "venv", "env", "dist", "build", ".next", "coverage",
]);
const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);

export class CodeFilter {
  private root: string;
  private cache = new Map<string, boolean>();

  constructor(projectRoot: string) {
    let root = path.resolve(projectRoot);
    try {
      root = realpathSync(root);
    } catch { /* 없는 경로면 그대로 */ }
    this.root = root + path.sep;
  }

  /** 개요: 이 파일(경로 또는 file:// URL)을 계측할지 판정한다. */
  shouldInstrument(fileOrUrl: string): boolean {
    const cached = this.cache.get(fileOrUrl);
    if (cached !== undefined) return cached;
    const result = this.decide(fileOrUrl);
    this.cache.set(fileOrUrl, result);
    return result;
  }

  /** 개요: 프로젝트 루트 기준 상대경로를 돌려준다(function_id용). */
  relPath(fileOrUrl: string): string {
    const p = this.toPath(fileOrUrl);
    return p.startsWith(this.root) ? p.slice(this.root.length) : p;
  }

  private toPath(fileOrUrl: string): string {
    try {
      const p = fileOrUrl.startsWith("file://")
        ? fileURLToPath(fileOrUrl)
        : path.resolve(fileOrUrl);
      if (p.startsWith(this.root)) return p;
      try {
        return realpathSync(p); // 심볼릭 링크 경유 경로 정규화
      } catch {
        return p;
      }
    } catch {
      return "";
    }
  }

  private decide(fileOrUrl: string): boolean {
    if (!fileOrUrl || fileOrUrl.startsWith("node:") || fileOrUrl.startsWith("data:")) {
      return false;
    }
    const p = this.toPath(fileOrUrl);
    if (!p || !p.startsWith(this.root)) return false;
    if (!EXTENSIONS.has(path.extname(p))) return false;
    const parts = p.slice(this.root.length).split(path.sep);
    for (const part of parts.slice(0, -1)) {
      if (EXCLUDED_DIR_NAMES.has(part) || part.startsWith(".")) return false;
    }
    return true;
  }
}
