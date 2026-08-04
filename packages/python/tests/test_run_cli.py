import subprocess
import sys
import textwrap
from pathlib import Path

from flowlens.db.connect import open_db

DEMO = textwrap.dedent(
    """
    def work(n):
        '''개요: 값을 세 배로 만든다.'''
        return n * 3

    print(work(4))
    """
)

FLOWLENS_BIN = Path(sys.executable).parent / "flowlens"


def test_run_wraps_and_records(tmp_path):
    """개요: flowlens run이 자식을 정상 실행하고 .flowlens/data.db에 기록하는지 검증한다."""
    (tmp_path / "demo.py").write_text(DEMO)
    proc = subprocess.run(
        [str(FLOWLENS_BIN), "run", sys.executable, "demo.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "12" in proc.stdout

    db = tmp_path / ".flowlens" / "data.db"
    assert db.exists()
    conn = open_db(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0] == 1
        names = {r[0] for r in conn.execute("SELECT name FROM spans").fetchall()}
        assert "work" in names
    finally:
        conn.close()


def test_run_propagates_exit_code(tmp_path):
    """개요: 자식의 실패 종료코드가 그대로 전파되는지 검증한다."""
    (tmp_path / "fail.py").write_text("import sys; sys.exit(3)")
    proc = subprocess.run(
        [str(FLOWLENS_BIN), "run", sys.executable, "fail.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 3


def test_plain_run_creates_nothing(tmp_path):
    """개요: flowlens run 없이 실행하면 아무 흔적도 없는지 검증한다(오버헤드 0)."""
    (tmp_path / "demo.py").write_text(DEMO)
    proc = subprocess.run(
        [sys.executable, "demo.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0
    assert not (tmp_path / ".flowlens").exists()
