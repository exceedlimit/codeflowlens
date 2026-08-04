import os
import subprocess
import sys
import textwrap

from flowlens.db.connect import open_db

DEMO_SCRIPT = textwrap.dedent(
    """
    def greet(name):
        '''개요: 인사말을 만든다.'''
        return "hello " + name

    def main():
        '''개요: 진입점.'''
        return greet("world")

    result = main()
    print(result)
    """
)


def test_bootstrap_records_process_trace(tmp_path):
    """개요: 환경변수 세팅 + install()만으로 자식 프로세스 실행이 추적되는지 검증한다."""
    (tmp_path / "demo_script.py").write_text(DEMO_SCRIPT)
    db_path = tmp_path / ".flowlens" / "data.db"
    env = dict(
        os.environ,
        FLOWLENS_ENABLED="1",
        FLOWLENS_DB=str(db_path),
        FLOWLENS_PROJECT_ROOT=str(tmp_path),
    )
    code = "import flowlens.bootstrap as b; b.install(); import demo_script"
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    assert "hello world" in proc.stdout

    conn = open_db(db_path)
    try:
        traces = conn.execute(
            "SELECT entry_kind, status FROM traces"
        ).fetchall()
        assert len(traces) == 1
        assert traces[0][0] == "process"
        assert traces[0][1] == "ok"
        names = {r[0] for r in conn.execute("SELECT name FROM spans").fetchall()}
        assert {"greet", "main"} <= names
    finally:
        conn.close()


def test_bootstrap_noop_without_env(tmp_path):
    """개요: 환경변수가 없으면 아무 일도 하지 않는지 검증한다(운영 오버헤드 0)."""
    (tmp_path / "demo_script.py").write_text(DEMO_SCRIPT)
    env = {k: v for k, v in os.environ.items() if not k.startswith("FLOWLENS")}
    code = "import flowlens.bootstrap as b; b.install(); import demo_script"
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    assert not (tmp_path / ".flowlens").exists()


def test_bootstrap_never_breaks_app_on_bad_db(tmp_path):
    """개요: DB 경로가 못 쓰는 곳이어도 앱은 정상 실행되는지 검증한다(fail-open)."""
    (tmp_path / "demo_script.py").write_text(DEMO_SCRIPT)
    env = dict(
        os.environ,
        FLOWLENS_ENABLED="1",
        FLOWLENS_DB="/dev/null/cannot/exist/data.db",
        FLOWLENS_PROJECT_ROOT=str(tmp_path),
    )
    code = "import flowlens.bootstrap as b; b.install(); import demo_script"
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    assert "hello world" in proc.stdout
