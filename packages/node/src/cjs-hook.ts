// 개요: CJS(require) 경로 계측 — Module._compile을 패치해 컴파일 직전에 소스를 바꾼다.
// 참고: 커버리지 도구(nyc/pirates)들이 쓰는 검증된 방식. 디스크 원본은 불변.
import Module from "node:module";

import type { CodeFilter } from "./filter.js";
import { instrument } from "./instrument.js";

export function installCjsHook(filter: CodeFilter): void {
  const proto = Module.prototype as unknown as {
    _compile: (content: string, filename: string) => unknown;
  };
  const original = proto._compile;
  proto._compile = function (content: string, filename: string) {
    let source = content;
    try {
      if (filter.shouldInstrument(filename)) {
        const out = instrument(content, filter.relPath(filename));
        if (out) source = out;
      }
    } catch {
      /* fail-open */
    }
    return original.call(this, source, filename);
  };
}
