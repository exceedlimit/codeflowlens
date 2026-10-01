"""
개요: `cfl ui` — 모니터링 화면(@codeflowlens/ui)을 띄운다.
로직: 프로젝트에 설치된 UI → PATH에 설치된 UI → npx 내려받기 순으로 실행 명령을 고르고,
      DB를 지정하지 않았으면 프로젝트의 .codeflowlens/data.db를 넘긴다.
참고: UI는 Node 패키지라 Node 22+가 필요하다. Python 사용자는 따로 설치할 필요 없이 npx가 받아 온다.
"""

import shutil
import subprocess
import sys
from pathlib import Path

from codeflowlens.paths import db_path, find_project_root

UI_PACKAGE = "@codeflowlens/ui"
UI_BIN = "codeflowlens-ui"


def build_ui_command(project_root, extra_args, which=shutil.which):
    """
    개요: 모니터링 화면을 띄울 실행 명령(리스트)을 만든다.
    로직: 사용자가 --db를 주지 않았으면 프로젝트 DB 경로를 앞에 붙인다. 실행할 수단이 없으면 None.
    """
    root = Path(project_root)
    args = list(extra_args)
    if not any(a == "--db" or a.startswith("--db=") for a in args):
        args = ["--db", str(db_path(root)), *args]

    for name in (UI_BIN, UI_BIN + ".cmd"):  # .cmd는 Windows용 실행 파일
        local = root / "node_modules" / ".bin" / name
        if local.exists():
            return [str(local), *args]
    global_bin = which(UI_BIN)
    if global_bin:
        return [global_bin, *args]
    npx = which("npx")
    if npx:
        return [npx, "-y", UI_PACKAGE, *args]
    return None


def run_ui(extra_args) -> int:
    """
    개요: 현재 프로젝트 기준으로 모니터링 화면을 띄우고, 종료될 때까지 기다린다.
    참고: Ctrl+C로 끄면 정상 종료(0)로 본다.
    """
    root = find_project_root()
    cmd = build_ui_command(root, extra_args)
    if cmd is None:
        print(
            "모니터링 화면을 띄우려면 Node 22 이상이 필요합니다 (npx를 찾지 못했습니다).\n"
            "  Node 설치: https://nodejs.org  — 설치 후 다시 `cfl ui`를 실행하세요.",
            file=sys.stderr,
        )
        return 1
    try:
        return subprocess.call(cmd, cwd=root)
    except KeyboardInterrupt:
        return 0
