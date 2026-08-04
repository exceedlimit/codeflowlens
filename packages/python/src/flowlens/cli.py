"""
개요: flowlens 명령줄 도구. M1은 run만, M2에서 init/check/scan이 추가된다.
"""

import sys


def main(argv=None) -> int:
    """개요: 서브커맨드를 해석해 실행한다."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(
            "flowlens — 바이브코딩 모니터링\n\n"
            "사용법:\n"
            "  flowlens run <명령> [인자...]   명령을 추적 상태로 실행\n"
            "                                  예: flowlens run uvicorn main:app\n"
            "  flowlens scan                   코드를 정적 분석해 코드맵 갱신\n"
            "  flowlens check [--json]         주석 룰 준수 검사 (위반 시 종료코드 1)\n"
        )
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "run":
        from flowlens.run import run_command
        return run_command(rest)
    if cmd == "scan":
        from flowlens.scan_cmd import scan
        scan()
        return 0
    if cmd == "check":
        from flowlens.check_cmd import run_check
        return run_check(as_json="--json" in rest)
    print(f"알 수 없는 명령: {cmd} (flowlens --help 참고)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
