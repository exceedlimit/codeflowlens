// 개요: scan/check 명령 구현 — 정적 분석 실행/저장과 주석 룰 검사.
// 참고: 판정 룰은 파이썬 check_cmd.py와 동일(PRD 6절): 함수 개요+로직(완화 대상은 개요만),
//       엔티티 개요+모든 필드 설명. 위반 시 종료코드 1.
import path from "node:path";

import { openDb, saveScan } from "./store.js";
import { scanProject, type FunctionInfo, type ScanResult } from "./tsscan.js";

export function runScan(root: string): void {
  const result = scanProject(root);
  const db = openDb(path.join(root, ".flowlens", "data.db"));
  try {
    saveScan(db, result);
  } finally {
    db.close();
  }
  const documented = result.functions.filter((f) => f.doc.overview).length;
  const total = result.functions.length;
  const cov = total ? Math.round((documented / total) * 1000) / 10 : 100;
  console.log(
    `스캔 완료: 함수 ${total}개 (주석 있음 ${documented}개, 커버리지 ${cov}%), ` +
      `엔티티 ${result.entities.length}개`,
  );
}

interface Violation {
  kind: "function" | "entity";
  target: string;
  line: number;
  missing: string[];
}

function isRelaxed(f: FunctionInfo): boolean {
  const simple = f.qualifiedName.split(".").pop()!;
  if (simple.startsWith("_")) return true;
  const parts = f.filePath.split("/");
  const file = parts[parts.length - 1];
  return (
    parts.includes("tests") || parts.includes("test") ||
    file.startsWith("test_") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

export function findViolations(result: ScanResult): Violation[] {
  const violations: Violation[] = [];
  for (const f of result.functions) {
    const missing: string[] = [];
    if (!f.doc.overview) missing.push("개요");
    if (!isRelaxed(f) && !f.doc.logic) missing.push("로직");
    if (missing.length) {
      violations.push({ kind: "function", target: f.id, line: f.line, missing });
    }
  }
  for (const e of result.entities) {
    const missing: string[] = [];
    if (!e.doc.overview) missing.push("개요");
    const undocumented = e.fields.filter((fl) => !fl.description).map((fl) => fl.name);
    if (undocumented.length) missing.push(`파라미터(${undocumented.join(", ")})`);
    if (missing.length) {
      violations.push({ kind: "entity", target: e.id, line: e.line, missing });
    }
  }
  return violations;
}

export function runCheck(root: string, asJson = false): number {
  const violations = findViolations(scanProject(root));
  if (asJson) {
    console.log(JSON.stringify({ violations }, null, 2));
  } else if (violations.length === 0) {
    console.log("통과: 모든 함수/엔티티가 주석 룰을 지키고 있습니다.");
  } else {
    console.log(`위반 ${violations.length}건 — 누락된 주석을 채워주세요:\n`);
    for (const v of violations) {
      const label = v.kind === "function" ? "함수" : "엔티티";
      console.log(`  [${label}] ${v.target}:${v.line} — 누락: ${v.missing.join(", ")}`);
    }
    console.log("\n형식 예시는 AGENTS.md의 FlowLens 주석 룰 섹션을 참고하세요.");
  }
  return violations.length ? 1 : 0;
}
