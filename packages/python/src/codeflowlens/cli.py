"""
개요: codeflowlens(축약 cfl) 명령줄 도구 — run / scan / check / init / ui.
"""

import sys


def main(argv=None) -> int:
    """개요: 서브커맨드를 해석해 실행한다."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(
            "codeflowlens — 바이브코딩 모니터링  (축약 명령: cfl)\n\n"
            "사용법:\n"
            "  cfl run <명령> [인자...]   명령을 추적 상태로 실행\n"
            "                             예: cfl run uvicorn main:app\n"
            "  cfl scan                   코드를 정적 분석해 코드맵 갱신\n"
            "  cfl check [--json]         주석 룰 준수 검사 (위반 시 종료코드 1)\n"
            "  cfl init [--lang a,b]      프로젝트에 이식 (룰 셋팅 + 첫 스캔)\n"
            "  cfl ui [--port N]          모니터링 화면 열기 (Node 22+ 필요)\n\n"
            "cfl 대신 codeflowlens 를 써도 똑같이 동작합니다.\n"
        )
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "run":
        from codeflowlens.run import run_command
        return run_command(rest)
    if cmd == "scan":
        from codeflowlens.scan_cmd import scan
        scan()
        return 0
    if cmd == "check":
        from codeflowlens.check_cmd import run_check
        return run_check(as_json="--json" in rest)
    if cmd == "init":
        from codeflowlens.init_cmd import run_init
        langs = None
        if "--lang" in rest:
            langs = rest[rest.index("--lang") + 1].split(",")
        return run_init(langs=langs)
    if cmd == "ui":
        from codeflowlens.ui_cmd import run_ui
        return run_ui(rest)
    print(f"알 수 없는 명령: {cmd} (codeflowlens --help 참고)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
