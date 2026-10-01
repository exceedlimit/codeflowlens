"""
개요: 추적 이벤트를 모아서 배치로 SQLite에 기록하는 writer.
로직: 호출 스레드는 큐에 넣기만 하고, 백그라운드 스레드가 주기적으로 한 트랜잭션씩 반영한다.
참고: 사용자 코드 실행을 막지 않기 위한 구조. writer 인터페이스(trace_start/span_finish/
      trace_end/runtime_edge/close)만 유지하면 HTTP 전송 방식 등으로 교체 가능하다(PRD 5절).
"""

import atexit
import queue
import threading

from codeflowlens.db.connect import open_db

FLUSH_INTERVAL = 0.25   # 초
FLUSH_BATCH = 500       # 건

_TRACE_COLS = [
    "id", "started_at", "ended_at", "status", "entry_kind", "entry_name",
    "http_method", "http_path", "http_status", "source", "client_trace_id", "service",
]
_SPAN_COLS = [
    "id", "trace_id", "parent_id", "function_id", "name",
    "started_at", "ended_at", "status", "args_json", "return_json", "error_json", "seq",
]


class BatchWriter:
    """
    개요: 추적 데이터를 배치로 기록한다. 내부 오류 시 스스로 비활성화된다(fail-open).
    """

    def __init__(self, db_path):
        self._q = queue.SimpleQueue()
        self._disabled = False
        self._closed = threading.Event()
        self._db_path = db_path
        self._thread = threading.Thread(
            target=self._worker, name="codeflowlens-writer", daemon=True
        )
        self._thread.start()
        atexit.register(self.close)

    # --- 인터페이스 (추적기가 호출) -------------------------------------

    def trace_start(self, row: dict):
        """개요: 트레이스 시작 행을 큐에 넣는다."""
        self._put(("trace_start", row))

    def span_finish(self, row: dict):
        """개요: 완료된 스팬 1건을 큐에 넣는다."""
        self._put(("span_finish", row))

    def trace_end(self, trace_id: str, ended_at: float, status: str, http_status=None):
        """개요: 트레이스 종료(상태 갱신)를 큐에 넣는다."""
        self._put(("trace_end", {
            "id": trace_id, "ended_at": ended_at, "status": status,
            "http_status": http_status,
        }))

    def runtime_edge(self, caller_id: str, callee_id: str):
        """개요: 실행에서 관측된 호출 관계(A→B)를 큐에 넣는다. count가 누적된다."""
        self._put(("runtime_edge", {"caller": caller_id, "callee": callee_id}))

    def close(self):
        """개요: 잔여 버퍼를 모두 기록하고 종료한다. 프로세스 종료 시 자동 호출된다."""
        if self._closed.is_set():
            return
        self._closed.set()
        self._thread.join(timeout=5.0)

    # --- 내부 구현 ------------------------------------------------------

    def _put(self, item):
        if not self._disabled:
            try:
                self._q.put(item)
            except Exception:
                self._disabled = True

    def _worker(self):
        """
        개요: 큐를 비워 DB에 반영하는 백그라운드 루프.
        로직: 250ms마다(또는 종료 신호 시) 쌓인 이벤트를 한 트랜잭션으로 기록한다.
        참고: DB 오류가 나면 기록을 포기하고 스스로 꺼진다 — 앱은 계속 돈다.
        """
        try:
            conn = open_db(self._db_path)
        except Exception:
            self._disabled = True
            return
        try:
            while True:
                closing = self._closed.wait(timeout=FLUSH_INTERVAL)
                self._flush(conn)
                if closing and self._q.empty():
                    break
        except Exception:
            self._disabled = True
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _flush(self, conn):
        batch = []
        while len(batch) < FLUSH_BATCH * 4:
            try:
                batch.append(self._q.get_nowait())
            except queue.Empty:
                break
        if not batch:
            return
        try:
            with conn:  # 한 트랜잭션
                for kind, row in batch:
                    try:
                        self._apply(conn, kind, row)
                    except Exception:
                        continue  # 나쁜 행 1건은 버리고 계속 (fail-open)
        except Exception:
            self._disabled = True

    @staticmethod
    def _apply(conn, kind: str, row: dict):
        if kind == "trace_start":
            cols = [c for c in _TRACE_COLS if c in row]
            sql = "INSERT OR REPLACE INTO traces ({}) VALUES ({})".format(
                ",".join(cols), ",".join("?" * len(cols)))
            conn.execute(sql, [row[c] for c in cols])
        elif kind == "span_finish":
            conn.execute(
                "INSERT INTO spans ({}) VALUES ({})".format(
                    ",".join(_SPAN_COLS), ",".join("?" * len(_SPAN_COLS))),
                [row[c] for c in _SPAN_COLS],
            )
        elif kind == "trace_end":
            conn.execute(
                "UPDATE traces SET ended_at=?, status=?, http_status=COALESCE(?, http_status) WHERE id=?",
                (row["ended_at"], row["status"], row["http_status"], row["id"]),
            )
        elif kind == "runtime_edge":
            conn.execute(
                "INSERT INTO call_edges (caller_id, callee_id, kind, count) VALUES (?,?,'runtime',1) "
                "ON CONFLICT(caller_id, callee_id, kind) DO UPDATE SET count = count + 1",
                (row["caller"], row["callee"]),
            )
