// 개요: TS 정적 분석 결과를 DB에 저장 — language='typescript' 데이터만 교체한다.
// 참고: 파이썬 analyzer/store.py와 동일한 교체 시맨틱(실행 기록·타 언어 데이터 보존).
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ScanResult } from "./tsscan.js";

const LANG = "typescript";

function readSchema(): string {
  // src에서는 ../db, 번들(dist 루트 청크)에서는 ./db 에 위치한다
  for (const rel of ["./db/schema.sql", "../db/schema.sql"]) {
    try {
      return readFileSync(new URL(rel, import.meta.url), "utf-8");
    } catch { /* 다음 후보 */ }
  }
  throw new Error("schema.sql not found");
}

export function openDb(dbPath: string): Database.Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(readSchema());
  if (!db.prepare("SELECT version FROM schema_version").get()) {
    db.prepare("INSERT INTO schema_version VALUES (1)").run();
    const ins = db.prepare("INSERT OR IGNORE INTO settings VALUES (?, ?)");
    ins.run("retention_days", "7");
    ins.run("value_max_bytes", "65536");
  }
  return db;
}

export function saveScan(db: Database.Database, result: ScanResult): void {
  const now = Date.now() / 1000;
  const tx = db.transaction(() => {
    db.prepare(
      "DELETE FROM call_edges WHERE kind='static' AND caller_id IN (SELECT id FROM functions WHERE language = ?)",
    ).run(LANG);
    db.prepare(
      "DELETE FROM entity_fields WHERE entity_id IN (SELECT id FROM entities WHERE language = ?)",
    ).run(LANG);
    db.prepare(
      "DELETE FROM entity_relations WHERE from_id IN (SELECT id FROM entities WHERE language = ?)",
    ).run(LANG);
    db.prepare(
      "DELETE FROM entity_usages WHERE entity_id IN (SELECT id FROM entities WHERE language = ?)",
    ).run(LANG);
    db.prepare("DELETE FROM entities WHERE language = ?").run(LANG);
    db.prepare("DELETE FROM functions WHERE language = ?").run(LANG);

    const insFn = db.prepare(
      `INSERT OR REPLACE INTO functions
       (id, language, file_path, qualified_name, line, doc_overview, doc_logic, doc_note, is_entity_method, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    for (const f of result.functions) {
      insFn.run(f.id, LANG, f.filePath, f.qualifiedName, f.line,
        f.doc.overview, f.doc.logic, f.doc.note, now);
    }
    const insEdge = db.prepare(
      "INSERT OR REPLACE INTO call_edges (caller_id, callee_id, kind, count) VALUES (?, ?, 'static', 0)",
    );
    for (const [a, b] of result.staticEdges) insEdge.run(a, b);

    const insEnt = db.prepare(
      `INSERT OR REPLACE INTO entities (id, language, file_path, name, doc_overview, doc_note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insField = db.prepare(
      "INSERT OR REPLACE INTO entity_fields (entity_id, name, type, description) VALUES (?, ?, ?, ?)",
    );
    for (const e of result.entities) {
      insEnt.run(e.id, LANG, e.filePath, e.name, e.doc.overview, e.doc.note, now);
      for (const f of e.fields) insField.run(e.id, f.name, f.type, f.description);
    }
    const insRel = db.prepare(
      "INSERT OR REPLACE INTO entity_relations (from_id, to_id, kind) VALUES (?, ?, 'ref')",
    );
    for (const [a, b] of result.relations) insRel.run(a, b);
    const insUse = db.prepare(
      "INSERT OR REPLACE INTO entity_usages (entity_id, function_id, role) VALUES (?, ?, ?)",
    );
    for (const [e, f, role] of result.usages) insUse.run(e, f, role);
  });
  tx();
}
