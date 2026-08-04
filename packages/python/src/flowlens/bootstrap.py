"""
개요: 환경변수(FLOWLENS_*)를 읽어 추적기를 현재 프로세스에 설치하는 진입점.
로직: flowlens run이 심어둔 sitecustomize.py가 이 모듈의 install()을 호출한다.
      환경변수가 없거나 설치 중 오류가 나면 아무 일도 하지 않는다(fail-open, 오버헤드 0).
참고: 프로세스 종료 시 트레이스를 닫는 atexit 훅을 함께 등록한다.
"""

import atexit
import os
import sys

_installed = False


def install():
    """
    개요: 추적기를 설치한다. FLOWLENS_ENABLED=1일 때만 동작한다.
    로직: writer→필터→세션→백엔드 순으로 구성하고, ASGI 요청 그룹핑 패치를 시도한다.
    참고: 어떤 오류도 사용자 앱으로 전파하지 않는다.
    """
    global _installed
    try:
        if _installed or os.environ.get("FLOWLENS_ENABLED") != "1":
            return
        db_path = os.environ.get("FLOWLENS_DB")
        project_root = os.environ.get("FLOWLENS_PROJECT_ROOT") or os.getcwd()
        if not db_path:
            return

        from flowlens.db.writer import BatchWriter
        from flowlens.tracer.backends import select_backend
        from flowlens.tracer.core import TraceSession
        from flowlens.tracer.filter import CodeFilter

        writer = BatchWriter(db_path)
        code_filter = CodeFilter(project_root)
        entry_name = " ".join(
            [os.path.basename(sys.argv[0] or "python")] + sys.argv[1:3]
        ).strip() or "python"
        session = TraceSession(
            writer, code_filter, project_root,
            entry_kind="process", entry_name=entry_name, service="python",
            value_max_bytes=_read_value_max_bytes(db_path),
        )
        backend = select_backend(session)
        backend.install()
        _installed = True

        state = {"writer": writer, "session": session, "backend": backend}
        _register_shutdown(state)
        _try_patch_asgi(state)
    except Exception:
        pass  # 추적기는 어떤 경우에도 앱을 방해하지 않는다


def _read_value_max_bytes(db_path) -> int:
    """개요: 설정 화면에서 저장한 값 크기 상한을 읽는다(없으면 기본 64KB)."""
    try:
        from flowlens.db.connect import open_db

        conn = open_db(db_path)
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key='value_max_bytes'"
            ).fetchone()
            return max(1024, int(row[0])) if row else 65536
        finally:
            conn.close()
    except Exception:
        return 65536


def _register_shutdown(state):
    """개요: 프로세스가 끝날 때 트레이스를 닫고 버퍼를 비운다."""

    def shutdown():
        try:
            state["backend"].uninstall()
            state["session"].finish(status="ok")
            state["writer"].close()
        except Exception:
            pass

    atexit.register(shutdown)


def _try_patch_asgi(state):
    """개요: FastAPI/Starlette가 있으면 요청 단위 트레이스 그룹핑을 활성화한다."""
    try:
        from flowlens.tracer.asgi import patch_starlette
        patch_starlette(state["session"])
    except Exception:
        pass  # starlette 미설치 프로젝트 — 프로세스 트레이스 모드 유지
