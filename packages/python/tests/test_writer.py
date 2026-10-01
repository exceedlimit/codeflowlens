import threading

from codeflowlens.db.connect import open_db
from codeflowlens.db.writer import BatchWriter


def _trace_row(tid: str) -> dict:
    return {
        "id": tid, "started_at": 1.0, "entry_kind": "process",
        "entry_name": "python demo.py", "service": "python",
    }


def _span_row(sid: str, tid: str, seq: int, parent=None) -> dict:
    return {
        "id": sid, "trace_id": tid, "parent_id": parent,
        "function_id": "app.py::f", "name": "f",
        "started_at": 1.0, "ended_at": 2.0, "status": "ok",
        "args_json": "{}", "return_json": "null", "error_json": None, "seq": seq,
    }


def test_writer_persists_rows(tmp_path):
    """개요: trace/span/edge가 flush 후 DB에 반영되는지 검증한다."""
    db = tmp_path / "data.db"
    w = BatchWriter(db)
    w.trace_start(_trace_row("t1"))
    w.span_finish(_span_row("s1", "t1", 0))
    w.span_finish(_span_row("s2", "t1", 1, parent="s1"))
    w.runtime_edge("app.py::f", "app.py::g")
    w.runtime_edge("app.py::f", "app.py::g")
    w.trace_end("t1", ended_at=2.0, status="ok")
    w.close()

    conn = open_db(db)
    try:
        t = conn.execute("SELECT status, ended_at FROM traces WHERE id='t1'").fetchone()
        assert t == ("ok", 2.0)
        spans = conn.execute("SELECT id, parent_id FROM spans ORDER BY seq").fetchall()
        assert spans == [("s1", None), ("s2", "s1")]
        edge = conn.execute(
            "SELECT count FROM call_edges WHERE kind='runtime' AND caller_id='app.py::f'"
        ).fetchone()
        assert edge[0] == 2
    finally:
        conn.close()


def test_writer_thread_safety(tmp_path):
    """개요: 여러 스레드가 동시에 넣어도 유실이 없는지 검증한다."""
    db = tmp_path / "data.db"
    w = BatchWriter(db)
    w.trace_start(_trace_row("t1"))

    def put(base: int):
        for i in range(100):
            w.span_finish(_span_row(f"s{base}-{i}", "t1", base * 1000 + i))

    threads = [threading.Thread(target=put, args=(n,)) for n in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    w.close()

    conn = open_db(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM spans").fetchone()[0] == 400
    finally:
        conn.close()


def test_writer_survives_bad_row(tmp_path):
    """개요: 잘못된 행이 섞여도 예외가 밖으로 나가지 않고 이후 기록이 계속되는지 검증한다(fail-open)."""
    db = tmp_path / "data.db"
    w = BatchWriter(db)
    w.trace_start(_trace_row("t1"))
    w.span_finish({"id": "bad"})  # 필수 필드 누락 — 조용히 버려져야 함
    w.span_finish(_span_row("s1", "t1", 0))
    w.close()

    conn = open_db(db)
    try:
        ids = [r[0] for r in conn.execute("SELECT id FROM spans").fetchall()]
        assert "s1" in ids
    finally:
        conn.close()


def test_writer_retries_when_db_briefly_locked(tmp_path, monkeypatch):
    """
    개요: DB를 처음 여는 순간 잠깐 잠겨 있어도(다른 연결이 스키마를 만드는 중) 기록을 포기하지 않는지 검증한다.
    참고: 새 DB 파일을 여러 연결이 동시에 열 때 'database is locked'가 나서 실행 기록이 통째로 사라지던 문제.
    """
    import sqlite3

    import codeflowlens.db.writer as writer_mod

    real_open = writer_mod.open_db
    calls = {"n": 0}

    def flaky_open(path):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise sqlite3.OperationalError("database is locked")
        return real_open(path)

    monkeypatch.setattr(writer_mod, "open_db", flaky_open)
    db = tmp_path / "data.db"
    w = BatchWriter(db)
    w.trace_start(_trace_row("t1"))
    w.close()

    conn = open_db(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0] == 1
    finally:
        conn.close()
