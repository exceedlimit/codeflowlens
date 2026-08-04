// 개요: 보존 주기(retention_days)가 지난 실행 기록을 삭제하는 정리기.
// 로직: settings에서 주기를 읽어 기준 시각보다 오래된 traces/spans/client_events를 지운다.
// 참고: 코드맵(functions/entities/관계)은 시간과 무관하므로 절대 지우지 않는다(PRD 9절).
import type Database from "better-sqlite3";

export interface CleanupResult {
  traces: number;
  spans: number;
  clientEvents: number;
}

export function cleanupOldData(db: Database.Database): CleanupResult {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'retention_days'")
    .get() as { value: string } | undefined;
  const days = Math.max(1, Number(row?.value ?? 7) || 7);
  const cutoff = Date.now() / 1000 - days * 86400;

  const tx = db.transaction(() => {
    const spans = db
      .prepare(
        "DELETE FROM spans WHERE trace_id IN (SELECT id FROM traces WHERE started_at < ?)",
      )
      .run(cutoff).changes;
    const traces = db.prepare("DELETE FROM traces WHERE started_at < ?").run(cutoff).changes;
    const clientEvents = db
      .prepare("DELETE FROM client_events WHERE started_at < ?")
      .run(cutoff).changes;
    return { traces, spans, clientEvents };
  });
  const result = tx();
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch { /* 정리 부가 작업 실패는 무시 */ }
  return result;
}

/** 개요: 기동 시 1회 + 24시간마다 정리를 돌리는 스케줄러(타이머는 프로세스 종료를 막지 않음). */
export function scheduleCleanup(getDb: () => Database.Database | null): NodeJS.Timeout {
  const run = () => {
    try {
      const db = getDb();
      if (db) cleanupOldData(db);
    } catch { /* 정리 실패는 서버 동작에 영향 없음 */ }
  };
  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
