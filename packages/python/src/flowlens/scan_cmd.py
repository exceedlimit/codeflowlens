"""
개요: `flowlens scan` — 프로젝트를 정적 분석해 코드맵(함수/주석/관계/엔티티)을 DB에 채운다.
"""

from flowlens.analyzer.pyscan import scan_project
from flowlens.analyzer.store import coverage_summary, save_scan
from flowlens.db.connect import open_db
from flowlens.paths import db_path, find_project_root


def scan(root=None, quiet=False) -> dict:
    """
    개요: 스캔을 실행하고 요약을 돌려준다.
    로직: 프로젝트 루트를 찾아 분석 → DB 저장 → 요약 출력.
    """
    from flowlens.usage_doc import ensure_usage_md

    root = root or find_project_root()
    ensure_usage_md(root)
    result = scan_project(root)
    conn = open_db(db_path(root))
    try:
        save_scan(conn, result)
    finally:
        conn.close()
    summary = coverage_summary(result)
    if not quiet:
        print(
            f"스캔 완료: 함수 {summary['functions']}개 "
            f"(주석 있음 {summary['documented']}개, 커버리지 {summary['coverage']}%), "
            f"엔티티 {summary['entities']}개"
        )
    return summary
