"""
개요: 추적 데이터 저장용 SQLite 연결을 담당한다.
"""

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
SCHEMA_VERSION = 1

DEFAULT_SETTINGS = [
    ("retention_days", "7"),
    ("value_max_bytes", "65536"),
]


def open_db(path) -> sqlite3.Connection:
    """
    개요: 추적 데이터 저장용 SQLite 연결을 연다.
    로직: 폴더를 만들고 WAL/busy_timeout을 설정한 뒤, 스키마가 없으면 생성하고 기본 설정값을 심는다.
    참고: 여러 번 열어도 안전하다(idempotent). 여러 프로세스가 같은 파일을 동시에 써도 WAL이 보호한다.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA_PATH.read_text())
    if conn.execute("SELECT version FROM schema_version").fetchone() is None:
        conn.execute("INSERT INTO schema_version VALUES (?)", (SCHEMA_VERSION,))
        conn.executemany(
            "INSERT OR IGNORE INTO settings VALUES (?, ?)", DEFAULT_SETTINGS
        )
    conn.commit()
    return conn
