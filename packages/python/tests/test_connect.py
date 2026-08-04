import sqlite3

from flowlens.db.connect import open_db


def _tables(conn: sqlite3.Connection) -> set:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def test_open_db_creates_schema(tmp_path):
    """개요: 없는 경로에 DB를 열면 폴더·스키마·기본 설정이 만들어지는지 검증한다."""
    db_path = tmp_path / "nested" / "data.db"
    conn = open_db(db_path)
    try:
        assert db_path.exists()
        expected = {
            "schema_version", "traces", "spans", "functions", "call_edges",
            "entities", "entity_fields", "entity_relations", "entity_usages",
            "client_events", "settings",
        }
        assert expected <= _tables(conn)
        assert conn.execute("SELECT version FROM schema_version").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        settings = dict(conn.execute("SELECT key, value FROM settings").fetchall())
        assert settings["retention_days"] == "7"
        assert settings["value_max_bytes"] == "65536"
    finally:
        conn.close()


def test_open_db_idempotent(tmp_path):
    """개요: 같은 DB를 두 번 열어도(재실행) 데이터가 깨지지 않는지 검증한다."""
    db_path = tmp_path / "data.db"
    conn1 = open_db(db_path)
    conn1.execute(
        "INSERT INTO traces (id, started_at, entry_kind, entry_name) VALUES ('t1', 1.0, 'process', 'x')"
    )
    conn1.commit()
    conn1.close()

    conn2 = open_db(db_path)
    try:
        assert conn2.execute("SELECT COUNT(*) FROM traces").fetchone()[0] == 1
        # schema_version 행이 중복 삽입되지 않아야 한다
        assert conn2.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 1
    finally:
        conn2.close()
