import importlib.util
import json
from pathlib import Path

import pytest

from flowlens.db.connect import open_db
from flowlens.db.writer import BatchWriter
from flowlens.tracer.core import TraceSession
from flowlens.tracer.filter import CodeFilter

FIXTURES = Path(__file__).parent / "tracer_fixtures"

_spec = importlib.util.spec_from_file_location("demo_mod", FIXTURES / "demo_mod.py")
demo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(demo)


def _make_backend(name, session):
    if name == "settrace":
        from flowlens.tracer.backend_settrace import SettraceBackend
        return SettraceBackend(session)
    import sys
    if sys.version_info < (3, 12):
        pytest.skip("sys.monitoring은 3.12+")
    from flowlens.tracer.backend_monitoring import MonitoringBackend
    return MonitoringBackend(session)


@pytest.fixture(params=["settrace", "monitoring"])
def backend_name(request):
    return request.param


def run_traced(tmp_path, backend_name, fn):
    """개요: 추적을 켠 상태로 fn을 실행하고 DB에 남은 트레이스/스팬을 돌려준다."""
    db_path = tmp_path / "data.db"
    writer = BatchWriter(db_path)
    session = TraceSession(
        writer, CodeFilter(FIXTURES), FIXTURES,
        entry_kind="process", entry_name="test",
    )
    backend = _make_backend(backend_name, session)
    backend.install()
    try:
        result = fn()
    finally:
        backend.uninstall()
        session.finish(status="ok")
        writer.close()

    conn = open_db(db_path)
    try:
        conn.row_factory = lambda c, r: {
            d[0]: r[i] for i, d in enumerate(c.description)
        }
        spans = conn.execute("SELECT * FROM spans ORDER BY seq").fetchall()
        traces = conn.execute("SELECT * FROM traces").fetchall()
        edges = conn.execute("SELECT * FROM call_edges WHERE kind='runtime'").fetchall()
    finally:
        conn.close()
    return result, traces, spans, edges


def by_name(spans, name):
    return [s for s in spans if s["name"] == name]


def test_call_tree_recorded(tmp_path, backend_name):
    """개요: 중첩 호출이 부모-자식 관계·인자·리턴값과 함께 기록되는지 검증한다."""
    result, traces, spans, edges = run_traced(tmp_path, backend_name, lambda: demo.outer(5))
    assert result == 10
    assert len(traces) == 1 and traces[0]["status"] == "ok"

    outer_spans = by_name(spans, "outer")
    inner_spans = by_name(spans, "inner")
    assert len(outer_spans) == 1 and len(inner_spans) == 2
    outer_span = outer_spans[0]
    assert outer_span["parent_id"] is None
    assert all(s["parent_id"] == outer_span["id"] for s in inner_spans)
    assert json.loads(outer_span["args_json"]) == {"n": 5}
    assert json.loads(outer_span["return_json"]) == 10
    assert json.loads(inner_spans[1]["args_json"]) == {"x": 5, "y": 5}
    assert outer_span["function_id"] == "demo_mod.py::outer"
    # seq 순서: outer가 먼저 시작
    assert outer_span["seq"] < inner_spans[0]["seq"] < inner_spans[1]["seq"]


def test_runtime_edges_recorded(tmp_path, backend_name):
    """개요: 실행에서 관측된 호출 관계가 count 누적으로 기록되는지 검증한다."""
    _, _, _, edges = run_traced(tmp_path, backend_name, lambda: demo.outer(5))
    e = [x for x in edges if x["caller_id"].endswith("::outer")]
    assert len(e) == 1
    assert e[0]["callee_id"] == "demo_mod.py::inner"
    assert e[0]["count"] == 2


def test_exception_recorded(tmp_path, backend_name):
    """개요: 예외가 난 함수의 스팬이 error로, 잡은 쪽은 ok로 기록되는지 검증한다."""
    result, _, spans, _ = run_traced(tmp_path, backend_name, lambda: demo.call_boom())
    assert result == "caught"
    boom_span = by_name(spans, "boom")[0]
    assert boom_span["status"] == "error"
    err = json.loads(boom_span["error_json"])
    assert err["type"] == "ValueError" and "bad" in err["message"]
    assert by_name(spans, "call_boom")[0]["status"] == "ok"


def test_untraced_code_excluded(tmp_path, backend_name):
    """개요: 표준 라이브러리 내부 호출은 스팬이 생기지 않는지 검증한다."""
    _, _, spans, _ = run_traced(tmp_path, backend_name, lambda: demo.uses_stdlib())
    assert {s["name"] for s in spans} == {"uses_stdlib"}


def test_thread_calls_recorded(tmp_path, backend_name):
    """개요: 새 스레드 안의 호출도 기록되는지 검증한다(부모 없으면 루트 직속)."""
    _, _, spans, _ = run_traced(tmp_path, backend_name, lambda: demo.run_in_thread())
    tw = by_name(spans, "thread_work")
    assert len(tw) == 1
    assert by_name(spans, "inner")[0]["parent_id"] == tw[0]["id"]


def test_async_calls_parented(tmp_path, backend_name):
    """개요: async 함수의 스팬이 await를 건너 올바른 부모·소요시간으로 기록되는지 검증한다."""
    result, _, spans, _ = run_traced(tmp_path, backend_name, lambda: demo.run_async())
    assert result == 42
    fetch_span = by_name(spans, "fetch")[0]
    helper_span = by_name(spans, "helper")[0]
    main_span = by_name(spans, "main_async")[0]
    # await 뒤에 호출된 helper의 부모가 fetch로 이어져야 한다
    assert helper_span["parent_id"] == fetch_span["id"]
    assert fetch_span["parent_id"] == main_span["id"]
    # 스팬이 첫 await에서 조기 종료되지 않아야 한다(리턴값이 기록됨)
    assert json.loads(fetch_span["return_json"]) == 42
    assert fetch_span["status"] == "ok"
