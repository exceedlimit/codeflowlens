import textwrap

from codeflowlens.analyzer.pyscan import scan_project
from codeflowlens.analyzer.store import save_scan
from codeflowlens.db.connect import open_db

SRC = textwrap.dedent(
    '''
    from pydantic import BaseModel

    class Item(BaseModel):
        """개요: 상품.
        파라미터:
          - sku: 상품 코드"""
        sku: str

    def pick(sku: str) -> Item:
        """개요: 상품을 고른다.
        로직: 코드로 찾는다."""
        return find(sku)

    def find(sku):
        """개요: 상품을 찾는다.
        로직: 저장소를 뒤진다."""
        return None
    '''
)


def make(tmp_path):
    (tmp_path / "shop.py").write_text(SRC)
    db = tmp_path / ".codeflowlens" / "data.db"
    return tmp_path, db


def test_scan_saved_to_tables(tmp_path):
    """개요: 스캔 결과가 각 테이블에 저장되는지 검증한다."""
    root, db_path = make(tmp_path)
    conn = open_db(db_path)
    save_scan(conn, scan_project(root))
    try:
        f = conn.execute(
            "SELECT doc_overview, doc_logic, language FROM functions WHERE id='shop.py::pick'"
        ).fetchone()
        assert f == ("상품을 고른다.", "코드로 찾는다.", "python")
        assert conn.execute(
            "SELECT COUNT(*) FROM call_edges WHERE kind='static' AND caller_id='shop.py::pick'"
        ).fetchone()[0] == 1
        e = conn.execute(
            "SELECT doc_overview FROM entities WHERE name='Item'"
        ).fetchone()
        assert e[0] == "상품."
        fld = conn.execute(
            "SELECT type, description FROM entity_fields WHERE name='sku'"
        ).fetchone()
        assert fld == ("str", "상품 코드")
        assert conn.execute(
            "SELECT COUNT(*) FROM entity_usages WHERE role='return'"
        ).fetchone()[0] == 1
    finally:
        conn.close()


def test_rescan_replaces_static_only(tmp_path):
    """개요: 재스캔이 정적 데이터만 교체하고 실행 기록은 보존하는지 검증한다."""
    root, db_path = make(tmp_path)
    conn = open_db(db_path)
    # 실행 기록(트레이스/스팬/runtime edge)을 먼저 넣는다
    conn.execute(
        "INSERT INTO traces (id, started_at, entry_kind, entry_name) VALUES ('t1', 1.0, 'process', 'x')"
    )
    conn.execute(
        "INSERT INTO call_edges VALUES ('shop.py::pick', 'shop.py::find', 'runtime', 5)"
    )
    conn.commit()

    save_scan(conn, scan_project(root))
    save_scan(conn, scan_project(root))  # 두 번 해도 중복 없음
    try:
        assert conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0] == 1
        assert conn.execute(
            "SELECT count FROM call_edges WHERE kind='runtime'"
        ).fetchone()[0] == 5
        assert conn.execute(
            "SELECT COUNT(*) FROM functions WHERE id='shop.py::pick'"
        ).fetchone()[0] == 1
    finally:
        conn.close()
