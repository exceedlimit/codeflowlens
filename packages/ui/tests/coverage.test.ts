// 개요: 주석 커버리지 API와 엔티티 관계 목록 테스트.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowlens-cov-"));
  const dbPath = join(dir, "data.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  const fn = db.prepare(
    "INSERT INTO functions (id, language, file_path, qualified_name, line, doc_overview) VALUES (?, ?, ?, ?, ?, ?)",
  );
  fn.run("a.py::f1", "python", "a.py", "f1", 1, "설명 있음");
  fn.run("a.py::f2", "python", "a.py", "f2", 5, null);
  fn.run("b.ts::g1", "typescript", "b.ts", "g1", 1, "설명 있음");
  db.prepare(
    "INSERT INTO entities (id, language, file_path, name) VALUES ('m.py::A', 'python', 'm.py', 'A')",
  ).run();
  db.prepare(
    "INSERT INTO entities (id, language, file_path, name) VALUES ('m.py::B', 'python', 'm.py', 'B')",
  ).run();
  db.prepare("INSERT INTO entity_relations VALUES ('m.py::A', 'm.py::B', 'ref')").run();
  db.close();
  server = await buildServer({ dbPath });
});

afterAll(async () => server.close());

describe("GET /api/coverage", () => {
  it("언어별 커버리지와 미주석 함수 목록을 준다", async () => {
    const res = await server.inject({ url: "/api/coverage" });
    const body = res.json();
    const py = body.languages.find((l: any) => l.language === "python");
    expect(py).toMatchObject({ total: 2, documented: 1 });
    const ts = body.languages.find((l: any) => l.language === "typescript");
    expect(ts).toMatchObject({ total: 1, documented: 1 });
    expect(body.undocumented).toHaveLength(1);
    expect(body.undocumented[0].id).toBe("a.py::f2");
  });
});

describe("GET /api/entities (관계 포함)", () => {
  it("relations 배열이 함께 온다", async () => {
    const res = await server.inject({ url: "/api/entities" });
    const body = res.json();
    expect(body.relations).toContainEqual({
      from_id: "m.py::A", to_id: "m.py::B", kind: "ref",
    });
  });
});
