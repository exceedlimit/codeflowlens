"""
개요: `flowlens run <명령>` — 사용자 명령을 추적기가 붙은 상태로 실행한다.
로직: sitecustomize.py(파이썬이 시작할 때 자동 import하는 파일)가 든 임시 폴더를
      PYTHONPATH 맨 앞에 넣고, FLOWLENS_* 환경변수를 세팅해 자식 프로세스를 실행한다.
참고: 코드 수정 0 원칙의 구현 지점. 자식의 종료코드를 그대로 반환한다.
"""

import os
import signal
import subprocess
import sys
import tempfile

from flowlens.paths import db_path, find_project_root

SITECUSTOMIZE = (
    "try:\n"
    "    import flowlens.bootstrap\n"
    "    flowlens.bootstrap.install()\n"
    "except Exception:\n"
    "    pass\n"
)


def run_command(argv) -> int:
    """개요: argv(예: ['uvicorn', 'main:app'])를 추적 상태로 실행하고 종료코드를 돌려준다."""
    if not argv:
        print("사용법: flowlens run <명령> [인자...]", file=sys.stderr)
        return 2
    root = find_project_root()
    with tempfile.TemporaryDirectory(prefix="flowlens-boot-") as boot_dir:
        with open(os.path.join(boot_dir, "sitecustomize.py"), "w") as f:
            f.write(SITECUSTOMIZE)

        env = dict(os.environ)
        env["FLOWLENS_ENABLED"] = "1"
        env["FLOWLENS_DB"] = str(db_path(root))
        env["FLOWLENS_PROJECT_ROOT"] = str(root)
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = boot_dir + (os.pathsep + existing if existing else "")

        # 풀스택 프로젝트: Node 추적기가 설치돼 있으면 자식 Node 프로세스도 추적된다
        node_register = (
            root / "node_modules" / "@flowlens" / "node" / "dist" / "register.mjs"
        )
        if node_register.exists():
            node_opt = f"--import {node_register.as_uri()}"
            prev = env.get("NODE_OPTIONS", "")
            env["NODE_OPTIONS"] = f"{prev} {node_opt}".strip()

        proc = subprocess.Popen(argv, env=env)

        def forward(signum, _frame):
            """개요: Ctrl+C 등 신호를 자식에게 넘긴다(자식이 정리할 시간을 준다)."""
            try:
                proc.send_signal(signum)
            except Exception:
                pass

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, forward)
            except Exception:
                pass
        return proc.wait()
