// 개요: 프로젝트 소스 파일 감시기 — 저장을 감지해 코드맵 재스캔을 요청한다.
// 로직: Node 내장 fs.watch(recursive)로 지켜보다가, 소스 파일이 바뀌면 잠깐 기다렸다(디바운스)
//       한 번만 알려준다. 연달아 저장해도 스캔은 마지막 한 번만 돈다.
// 참고: 감시에 실패해도 서버는 정상 동작한다(fail-open) — 수동 갱신 버튼이 있다.
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

const SOURCE_EXT = new Set([
  ".py", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);

const IGNORED_DIRS = new Set([
  ".flowlens", "node_modules", ".venv", "venv", "env", ".git", "dist", "build",
  "__pycache__", ".next", "coverage", ".pytest_cache", ".ruff_cache",
]);

export interface WatcherOptions {
  debounceMs?: number;
}

/** 개요: 감시를 시작하고, 멈추는 함수를 돌려준다. */
export function startCodeWatcher(
  root: string,
  onChange: () => void,
  opts: WatcherOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 1500;
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange();
      } catch {
        /* 재스캔 실패는 감시를 멈추지 않는다 */
      }
    }, debounceMs);
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename);
      const parts = rel.split(path.sep);
      if (parts.some((p) => IGNORED_DIRS.has(p))) return;
      if (!SOURCE_EXT.has(path.extname(rel))) return;
      schedule();
    });
    watcher.on("error", () => {
      /* 감시 오류 시 조용히 포기 — 수동 갱신으로 대체 */
    });
  } catch {
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      watcher?.close();
    } catch {
      /* 이미 닫힘 */
    }
  };
}
