// 개요: 재스캔 API 테스트 — 수동 갱신 요청과 상태 조회, 파일 변경 시 자동 갱신을 검증한다.
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

/** 개요: 가짜 스캔 명령을 가진 테스트 프로젝트를 만든다. */
function makeProject(): { root: string; dbPath: string; scanCommand: string; logPath: string } {
  const root = mkdtempSync(join(tmpdir(), "flowlens-scanapi-"));
  mkdirSync(join(root, ".flowlens"), { recursive: true });
  const dbPath = join(root, ".flowlens", "data.db");
  new Database(dbPath).exec(SCHEMA);
  const logPath = join(root, "scans.log");
  const script = join(root, "fake-scan.js");
  writeFileSync(
    script,
    `require("node:fs").appendFileSync(${JSON.stringify(logPath)}, "run\\n");\n` +
      "console.log('스캔 완료: 함수 5개 (주석 있음 5개, 커버리지 100%), 엔티티 2개')",
  );
  return { root, dbPath, scanCommand: `${process.execPath} ${script}`, logPath };
}

describe("POST /api/scan", () => {
  it("수동 갱신이 스캔을 돌리고 결과를 돌려준다", async () => {
    const { dbPath, root, scanCommand } = makeProject();
    const server = await buildServer({ dbPath, projectRoot: root, scanCommand });
    try {
      const before = await server.inject({ url: "/api/scan/status" });
      expect(before.json()).toMatchObject({ scanning: false, lastScanAt: null, watching: false });

      const res = await server.inject({ method: "POST", url: "/api/scan" });
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.message).toContain("함수 5개");
      expect(body.status.lastScanAt).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("스캔 명령을 못 찾으면 안내 메시지를 준다", async () => {
    const { dbPath, root } = makeProject();
    const server = await buildServer({ dbPath, projectRoot: root });
    try {
      const res = await server.inject({ method: "POST", url: "/api/scan" });
      expect(res.json().ok).toBe(false);
      expect(res.json().message).toContain("flowlens scan");
    } finally {
      await server.close();
    }
  });
});

describe("파일 변경 자동 감지", () => {
  it("소스 파일을 저장하면 자동으로 재스캔한다", async () => {
    const { dbPath, root, scanCommand, logPath } = makeProject();
    const server = await buildServer({
      dbPath, projectRoot: root, scanCommand,
      watch: true, watchDebounceMs: 40,
    });
    try {
      expect((await server.inject({ url: "/api/scan/status" })).json().watching).toBe(true);

      writeFileSync(join(root, "service.py"), "def f():\n    return 1\n");
      await new Promise((r) => setTimeout(r, 600));

      expect(readFileSync(logPath, "utf-8").trim()).toBe("run"); // 딱 한 번 스캔
      const status = (await server.inject({ url: "/api/scan/status" })).json();
      expect(status.lastScanAt).toBeGreaterThan(0);
      expect(status.lastResult.ok).toBe(true);
    } finally {
      await server.close();
    }
  });
});
