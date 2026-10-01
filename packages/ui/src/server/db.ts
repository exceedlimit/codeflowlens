// 개요: 추적 DB(SQLite)를 읽기 전용으로 여는 계층.
// 로직: DB 파일은 사용자가 codeflowlens run을 실행해야 생기므로, 없으면 매 요청마다
//       다시 확인한다(생기는 즉시 자동 연결).
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export class DbHandle {
  private db: Database.Database | null = null;
  private writeDb: Database.Database | null = null;

  constructor(readonly path: string) {}

  /** 개요: 읽기 연결을 돌려준다. 파일이 아직 없으면 null(빈 상태). */
  get(): Database.Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    this.db = new Database(this.path, { readonly: true, fileMustExist: true });
    this.db.pragma("busy_timeout = 3000");
    return this.db;
  }

  /** 개요: 쓰기 연결을 돌려준다(브라우저 이벤트 수집·설정 저장용). 파일 없으면 null. */
  getWrite(): Database.Database | null {
    if (this.writeDb) return this.writeDb;
    if (!existsSync(this.path)) return null;
    this.writeDb = new Database(this.path);
    this.writeDb.pragma("journal_mode = WAL");
    this.writeDb.pragma("busy_timeout = 3000");
    return this.writeDb;
  }

  exists(): boolean {
    return this.get() !== null;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.writeDb?.close();
    this.writeDb = null;
  }
}
