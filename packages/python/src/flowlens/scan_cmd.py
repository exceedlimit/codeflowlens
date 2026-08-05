"""
개요: `flowlens scan` — 프로젝트를 정적 분석해 코드맵(함수/주석/관계/엔티티)을 DB에 채운다.
로직: 프로젝트 언어 구성을 읽어 Python 스캐너(내장)와 Node 스캐너(@flowlens/node CLI)를
      각각 실행한다 — 풀스택이면 둘 다, 단일 언어면 해당 언어만.
"""

from flowlens.analyzer.pyscan import scan_project
from flowlens.analyzer.store import coverage_summary, save_scan
from flowlens.db.connect import open_db
from flowlens.langs import read_languages
from flowlens.nodecli import find_node_cli, parse_scan_summary, run_node_cli
from flowlens.paths import db_path, find_project_root

NODE_LANGS = {"node", "typescript", "browser"}


def _summary_line(s: dict) -> str:
    return (
        f"함수 {s['functions']}개 (주석 있음 {s['documented']}개, "
        f"커버리지 {s['coverage']}%), 엔티티 {s['entities']}개"
    )


def scan(root=None, quiet=False) -> dict:
    """
    개요: 스캔을 실행하고 언어별 요약을 돌려준다.
    로직: python이 있으면 내장 스캐너, node 계열이 있으면 Node CLI에 위임한다.
    참고: 반환 형식 {"python": 요약|None, "node": 요약|None, "notes": [안내문]}.
    """
    from flowlens.usage_doc import ensure_usage_md

    root = root or find_project_root()
    ensure_usage_md(root)
    langs = read_languages(root)
    result = {"python": None, "node": None, "notes": []}

    if "python" in langs:
        py_result = scan_project(root)
        conn = open_db(db_path(root))
        try:
            save_scan(conn, py_result)
        finally:
            conn.close()
        result["python"] = coverage_summary(py_result)
        if not quiet:
            print(f"스캔 완료 (Python): {_summary_line(result['python'])}")

    if NODE_LANGS & set(langs):
        code, output = run_node_cli(root, "scan")
        if code is None:
            note = (
                "TS/JS 스캔 건너뜀 — @flowlens/node가 설치되어 있지 않습니다. "
                "npm i -D @flowlens/node 후 다시 실행하세요."
            )
            result["notes"].append(note)
            if not quiet:
                print(note)
        else:
            result["node"] = parse_scan_summary(output)
            if not quiet:
                if result["node"]:
                    print(f"스캔 완료 (TS/JS): {_summary_line(result['node'])}")
                else:
                    print(output)

    return result
