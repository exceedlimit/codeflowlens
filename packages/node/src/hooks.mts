// 개요: ESM 로더 훅 — 모듈 로드 결과(소스)를 받아 프로젝트 코드만 계측해 돌려준다.
// 참고: 이 파일은 Node의 로더 스레드에서 실행된다(메인 스레드와 상태 공유 없음).
//       tsx/ts-node가 앞서 등록돼 있으면 nextLoad가 변환된 JS를 주므로 그 결과를 계측한다.
import type { InitializeHook, LoadHook } from "node:module";

import { CodeFilter } from "./filter.js";
import { instrument } from "./instrument.js";

let filter: CodeFilter | null = null;

export const initialize: InitializeHook = (data: { root?: string } | undefined) => {
  try {
    filter = new CodeFilter(data?.root ?? process.cwd());
  } catch {
    filter = null;
  }
};

export const load: LoadHook = async (url, context, nextLoad) => {
  const result = await nextLoad(url, context);
  try {
    if (!filter || !filter.shouldInstrument(url)) return result;
    const okFormats = new Set([
      "module", "commonjs", "module-typescript", "commonjs-typescript",
    ]);
    if (!okFormats.has(result.format as string)) return result;
    const source = result.source?.toString();
    if (!source) return result;
    const out = instrument(source, filter.relPath(url));
    if (out) {
      // 계측 결과는 항상 순수 JS (TS였다면 타입까지 벗겨졌다)
      const format = (result.format as string).startsWith("module") ? "module" : "commonjs";
      return { ...result, source: out, format };
    }
  } catch {
    /* fail-open: 원본 그대로 */
  }
  return result;
};
