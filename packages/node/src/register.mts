// 개요: `node --import @flowlens/node/register` 진입점 — 추적기를 현재 프로세스에 설치한다.
// 로직: 환경변수(FLOWLENS_*)가 있을 때만 런타임을 만들고, ESM 훅 등록 + CJS 패치 + http 훅을 건다.
// 참고: 어떤 오류도 사용자 앱으로 전파하지 않는다(fail-open). env 없으면 완전한 no-op.
import { register } from "node:module";
import path from "node:path";

import { installCjsHook } from "./cjs-hook.js";
import { CodeFilter } from "./filter.js";
import { installHttpHook } from "./http-hook.js";
import { FlowlensRuntime } from "./runtime.js";
import { BatchWriter } from "./writer.js";

try {
  if (process.env.FLOWLENS_ENABLED === "1" && process.env.FLOWLENS_DB) {
    const root = process.env.FLOWLENS_PROJECT_ROOT || process.cwd();

    const writer = new BatchWriter(process.env.FLOWLENS_DB);
    const entryName =
      process.argv.slice(1, 3).map((a) => path.basename(a)).join(" ") || "";
    // 설정 화면에서 저장한 값 크기 상한을 반영한다(없으면 기본 64KB)
    let maxBytes = 65536;
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(process.env.FLOWLENS_DB, { readonly: true });
      const row = db.prepare("SELECT value FROM settings WHERE key='value_max_bytes'").get() as
        { value: string } | undefined;
      if (row) maxBytes = Math.max(1024, Number(row.value) || 65536);
      db.close();
    } catch { /* 설정 못 읽으면 기본값 */ }
    const runtime = new FlowlensRuntime({
      writer, entryName: `node ${entryName}`.trim(), maxBytes,
    });
    (globalThis as Record<string, unknown>).__flowlens = runtime;

    const filter = new CodeFilter(root);
    installCjsHook(filter);
    register(new URL("./hooks.mjs", import.meta.url), { data: { root } });

    try {
      installHttpHook(runtime, writer);
    } catch {
      /* http 훅 실패 시 프로세스 트레이스 모드 유지 */
    }
  }
} catch {
  /* fail-open */
}
