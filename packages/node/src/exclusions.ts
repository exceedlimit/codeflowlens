// 개요: "이 진입점은 더이상 추적하지 않음" 목록을 읽는 캐시 (파이썬 exclusions.py와 동일 역할).
// 로직: settings의 excluded_entries(JSON 배열)를 10초마다 다시 읽는다 —
//       UI에서 바꾸면 실행 중인 앱에도 곧 반영된다.
// 참고: 읽기 실패 시 빈 목록(fail-open — 추적이 더 되는 쪽이 안전).
import Database from "better-sqlite3";

export class ExclusionCache {
  private entries = new Set<string>();
  private loadedAt = 0;

  constructor(private dbPath: string, private ttlMs = 10_000) {}

  isExcluded(entryName: string): boolean {
    const now = Date.now();
    if (now - this.loadedAt > this.ttlMs) {
      this.reload();
      this.loadedAt = now;
    }
    return this.entries.has(entryName);
  }

  private reload(): void {
    try {
      const db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      try {
        const row = db
          .prepare("SELECT value FROM settings WHERE key = 'excluded_entries'")
          .get() as { value: string } | undefined;
        const parsed = JSON.parse(row?.value ?? "[]");
        this.entries = new Set(Array.isArray(parsed) ? parsed : []);
      } finally {
        db.close();
      }
    } catch {
      this.entries = new Set();
    }
  }
}
