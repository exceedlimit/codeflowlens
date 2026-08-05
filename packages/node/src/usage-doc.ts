// 개요: 사용법 안내서(.flowlens/USAGE.md)를 프로젝트에 저장한다.
// 로직: 파일이 없을 때만 만든다(사용자 수정본 보존). 실패해도 조용히 넘어간다(fail-open).
// 참고: 파이썬 usage_doc.py와 동일 역할 — 내용은 동기화 테스트로 맞춘다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readTemplate(): string {
  // src에서는 ./templates, 번들(dist)에서는 ./templates (onSuccess가 복사)
  for (const rel of ["./templates/usage_guide.md", "../templates/usage_guide.md"]) {
    try {
      return readFileSync(new URL(rel, import.meta.url), "utf-8");
    } catch { /* 다음 후보 */ }
  }
  return "";
}

export function ensureUsageMd(projectRoot: string): void {
  try {
    const target = path.join(projectRoot, ".flowlens", "USAGE.md");
    if (existsSync(target)) return;
    const content = readTemplate();
    if (!content) return;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  } catch {
    /* 안내서 생성 실패가 추적/스캔을 막으면 안 된다 */
  }
}
