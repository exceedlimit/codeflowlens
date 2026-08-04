from pathlib import Path

import flowlens


def test_schema_copy_is_in_sync():
    """개요: 패키지에 내장된 스키마 사본이 계약 원본(packages/schema)과 동일한지 검증한다."""
    root = Path(__file__).resolve().parents[3]  # packages/python/tests -> repo root
    original = (root / "packages/schema/schema.sql").read_text()
    vendored = (Path(flowlens.__file__).parent / "db/schema.sql").read_text()
    assert original == vendored
