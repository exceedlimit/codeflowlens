import subprocess
import sys
import textwrap
from pathlib import Path

from codeflowlens.db.connect import open_db

DEMO = textwrap.dedent(
    """
    def work(n):
        '''개요: 값을 세 배로 만든다.'''
        return n * 3

    print(work(4))
    """
)

CODEFLOWLENS_BIN = Path(sys.executable).parent / "codeflowlens"


def test_run_wraps_and_records(tmp_path):
    """개요: codeflowlens run이 자식을 정상 실행하고 .codeflowlens/data.db에 기록하는지 검증한다."""
    (tmp_path / "demo.py").write_text(DEMO)
    proc = subprocess.run(
        [str(CODEFLOWLENS_BIN), "run", sys.executable, "demo.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "12" in proc.stdout

    db = tmp_path / ".codeflowlens" / "data.db"
    assert db.exists()
    assert (tmp_path / ".codeflowlens" / "USAGE.md").exists()  # 사용법 안내서 자동 생성
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
        [str(CODEFLOWLENS_BIN), "run", sys.executable, "fail.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 3


def test_run_injects_node_options_when_node_tracer_installed(tmp_path):
    """개요: 프로젝트에 @codeflowlens/node가 있으면 NODE_OPTIONS가 주입되는지 검증한다(풀스택 run)."""
    register = tmp_path / "node_modules" / "@codeflowlens" / "node" / "dist" / "register.mjs"
    register.parent.mkdir(parents=True)
    register.write_text("// stub")
    (tmp_path / "show_env.py").write_text(
        "import os; print(os.environ.get('NODE_OPTIONS', ''))"
    )
    proc = subprocess.run(
        [str(CODEFLOWLENS_BIN), "run", sys.executable, "show_env.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "register.mjs" in proc.stdout


def test_plain_run_creates_nothing(tmp_path):
    """개요: codeflowlens run 없이 실행하면 아무 흔적도 없는지 검증한다(오버헤드 0)."""
    (tmp_path / "demo.py").write_text(DEMO)
    proc = subprocess.run(
        [sys.executable, "demo.py"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0
    assert not (tmp_path / ".codeflowlens").exists()
