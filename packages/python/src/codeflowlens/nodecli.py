"""
개요: 프로젝트에 설치된 Node 쪽 codeflowlens CLI(@codeflowlens/node)를 찾아 실행하는 헬퍼.
로직: node_modules/.bin/codeflowlens 또는 @codeflowlens/node/dist/cli.js를 찾아 서브커맨드를 돌린다.
참고: Python CLI 하나로 풀스택 프로젝트의 scan/check가 양쪽 언어를 다 커버하게 하는 다리.
"""

import re
import subprocess
from pathlib import Path


def find_node_cli(project_root):
    """개요: Node CLI 실행 명령을 찾는다(없으면 None)."""
    root = Path(project_root)
    bin_path = root / "node_modules" / ".bin" / "codeflowlens"
    if bin_path.exists():
        return [str(bin_path)]
    cli_js = root / "node_modules" / "@codeflowlens" / "node" / "dist" / "cli.js"
    if cli_js.exists():
        return ["node", str(cli_js)]
    return None


def run_node_cli(project_root, subcommand, extra_args=()):
    """
    개요: Node CLI 서브커맨드를 실행하고 (종료코드, 출력)을 돌려준다.
    참고: CLI가 없으면 (None, None) — 호출부가 안내 메시지를 낸다.
    """
    cmd = find_node_cli(project_root)
    if cmd is None:
        return None, None
    try:
        proc = subprocess.run(
            [*cmd, subcommand, *extra_args],
            cwd=project_root, capture_output=True, text=True, timeout=300,
        )
        return proc.returncode, (proc.stdout + proc.stderr).strip()
    except Exception as e:
        return 1, f"Node 스캐너 실행 실패: {e}"


_SUMMARY_RE = re.compile(
    r"함수\s*(\d+)개\s*\(주석 있음\s*(\d+)개,\s*커버리지\s*([\d.]+)%\),\s*엔티티\s*(\d+)개"
)


def parse_scan_summary(output):
    """개요: 스캔 출력 문자열에서 요약 숫자를 뽑는다(형식이 다르면 None)."""
    m = _SUMMARY_RE.search(output or "")
    if not m:
        return None
    return {
        "functions": int(m.group(1)),
        "documented": int(m.group(2)),
        "coverage": float(m.group(3)),
        "entities": int(m.group(4)),
    }
