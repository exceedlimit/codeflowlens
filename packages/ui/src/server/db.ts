// 개요: 추적 DB(SQLite)를 읽기 전용으로 여는 계층.
// 로직: DB 파일은 사용자가 flowlens run을 실행해야 생기므로, 없으면 매 요청마다
//       다시 확인한다(생기는 즉시 자동 연결).
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export class DbHandle {
  private db: Database.Database | null = null;

  constructor(readonly path: string) {}

  /** 개요: 연결을 돌려준다. 파일이 아직 없으면 null(빈 상태). */
  get(): Database.Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    this.db = new Database(this.path, { readonly: true, fileMustExist: true });
    this.db.pragma("busy_timeout = 3000");
    return this.db;
  }

  exists(): boolean {
    return this.get() !== null;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
