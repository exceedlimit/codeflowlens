import asyncio
import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("starlette")
import httpx

from flowlens.db.connect import open_db
from flowlens.db.writer import BatchWriter
from flowlens.tracer.asgi import patch_starlette
from flowlens.tracer.backends import select_backend
from flowlens.tracer.core import TraceSession
from flowlens.tracer.filter import CodeFilter

FIXTURES = Path(__file__).parent / "tracer_fixtures"


def _load_app():
    spec = importlib.util.spec_from_file_location("asgi_app", FIXTURES / "asgi_app.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.app


def test_http_requests_become_traces(tmp_path):
    """개요: 요청 1건 = 트레이스 1건으로 묶이고 핸들러 스팬이 그 안에 담기는지 검증한다."""
    db_path = tmp_path / "data.db"
    writer = BatchWriter(db_path)
    session = TraceSession(
        writer, CodeFilter(FIXTURES), FIXTURES,
        entry_kind="process", entry_name="test-server",
    )
    unpatch = patch_starlette(session)
    app = _load_app()
    backend = select_backend(session)
    backend.install()
    try:
        async def drive():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                r1 = await client.get(
                    "/orders", headers={"x-flowlens-trace": "cli-123"}
                )
                r2 = await client.get("/orders")
                return r1, r2

        r1, r2 = asyncio.run(drive())
        assert r1.status_code == 200 and r2.status_code == 200
    finally:
        backend.uninstall()
        unpatch()
        session.finish("ok")
        writer.close()

    conn = open_db(db_path)
    try:
        conn.row_factory = lambda c, r: {d[0]: r[i] for i, d in enumerate(c.description)}
        http_traces = conn.execute(
            "SELECT * FROM traces WHERE entry_kind='http' ORDER BY started_at"
        ).fetchall()
        assert len(http_traces) == 2
        t = http_traces[0]
        assert t["entry_name"] == "GET /orders"
        assert t["http_method"] == "GET" and t["http_path"] == "/orders"
        assert t["http_status"] == 200 and t["status"] == "ok"
        assert t["client_trace_id"] == "cli-123"
        # 각 http 트레이스에 핸들러(orders)와 그 하위 호출(compute)이 담긴다
        for t in http_traces:
            names = {r["name"] for r in conn.execute(
                "SELECT name FROM spans WHERE trace_id=?", (t["id"],)
            ).fetchall()}
            assert "orders" in names and "compute" in names
    finally:
        conn.close()


def test_http_error_marks_trace_error(tmp_path):
    """개요: 핸들러 예외 시 트레이스가 error로 기록되는지 검증한다."""
    db_path = tmp_path / "data.db"
    writer = BatchWriter(db_path)
    session = TraceSession(
        writer, CodeFilter(FIXTURES), FIXTURES,
        entry_kind="process", entry_name="test-server",
    )
    unpatch = patch_starlette(session)
    app = _load_app()
    backend = select_backend(session)
    backend.install()
    try:
        async def drive():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                try:
                    await client.get("/fail")
                except Exception:
                    pass  # 미들웨어 없는 Starlette은 예외를 그대로 올린다

        asyncio.run(drive())
    finally:
        backend.uninstall()
        unpatch()
        session.finish("ok")
        writer.close()

    conn = open_db(db_path)
    try:
        row = conn.execute(
            "SELECT status FROM traces WHERE entry_kind='http' AND http_path='/fail'"
        ).fetchone()
        assert row[0] == "error"
    finally:
        conn.close()
