import textwrap

from codeflowlens.analyzer.pyscan import scan_project

SERVICE = textwrap.dedent(
    '''
    """개요: 주문 서비스."""
    from app.models import Order, OrderRequest

    def create_order(request: OrderRequest) -> Order:
        """
        개요: 주문을 생성한다.
        로직: 재고를 확인하고 저장한다.
        """
        validate(request)
        return save(request)

    def validate(request):
        """개요: 요청을 검증한다.
        로직: 수량이 양수인지 본다."""
        def _inner():
            return 1
        return _inner()

    async def save(request):
        """개요: 주문을 저장한다.
        로직: 저장소에 넘긴다."""
        return None
    '''
)

MODELS = textwrap.dedent(
    '''
    from dataclasses import dataclass
    from pydantic import BaseModel

    class OrderRequest(BaseModel):
        """
        개요: 주문 생성 요청.
        파라미터:
          - item_id: 상품 식별자
          - quantity: 주문 수량
        """
        item_id: str
        quantity: int

    class Order(BaseModel):
        """
        개요: 주문 엔티티.
        파라미터:
          - order_id: 주문 번호
          - request: 원본 요청
        참고: 취소 시 수량 0.
        """
        order_id: str
        request: OrderRequest

        def cancel(self):
            """개요: 주문을 취소한다.
            로직: 상태를 cancelled로 바꾼다."""
            return None

    @dataclass
    class Receipt:
        """개요: 영수증.
        파라미터:
          - total: 합계 금액"""
        total: int
    '''
)


def make_project(tmp_path):
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "service.py").write_text(SERVICE)
    (tmp_path / "app" / "models.py").write_text(MODELS)
    (tmp_path / "broken.py").write_text("def broken(:\n")  # 문법 오류
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "lib.py").write_text("def hidden(): pass\n")
    return tmp_path


def test_functions_extracted(tmp_path):
    """개요: 함수/메서드/중첩/async가 qualname·주석과 함께 추출되는지 검증한다."""
    r = scan_project(make_project(tmp_path))
    ids = {f["id"] for f in r.functions}
    assert "app/service.py::create_order" in ids
    assert "app/service.py::save" in ids  # async
    assert "app/service.py::validate.<locals>._inner" in ids  # 중첩(qualname 규칙)
    assert "app/models.py::Order.cancel" in ids  # 메서드
    f = next(x for x in r.functions if x["id"] == "app/service.py::create_order")
    assert f["doc"].overview == "주문을 생성한다."
    assert f["doc"].logic == "재고를 확인하고 저장한다."
    assert f["line"] > 0
    cancel = next(x for x in r.functions if x["id"] == "app/models.py::Order.cancel")
    assert cancel["is_entity_method"] is True


def test_excluded_and_broken_files(tmp_path):
    """개요: .venv 등 제외 폴더와 문법 오류 파일은 건너뛰는지 검증한다."""
    r = scan_project(make_project(tmp_path))
    ids = {f["id"] for f in r.functions}
    assert not any("hidden" in i for i in ids)
    assert not any("broken" in i for i in ids)


def test_static_edges(tmp_path):
    """개요: 함수 본문의 호출이 static edge로 수집되는지 검증한다(보수적 매칭)."""
    r = scan_project(make_project(tmp_path))
    assert ("app/service.py::create_order", "app/service.py::validate") in r.static_edges
    assert ("app/service.py::create_order", "app/service.py::save") in r.static_edges


def test_entities_and_fields(tmp_path):
    """개요: Pydantic/dataclass 엔티티와 필드·주석 설명이 추출되는지 검증한다."""
    r = scan_project(make_project(tmp_path))
    names = {e["name"] for e in r.entities}
    assert {"OrderRequest", "Order", "Receipt"} <= names
    order = next(e for e in r.entities if e["name"] == "Order")
    fields = {f["name"]: f for f in order["fields"]}
    assert fields["order_id"]["type"] == "str"
    assert fields["order_id"]["description"] == "주문 번호"
    assert order["doc"].note == "취소 시 수량 0."


def test_entity_relations_and_usages(tmp_path):
    """개요: 엔티티 간 참조와 함수의 엔티티 사용(param/return)이 추출되는지 검증한다."""
    r = scan_project(make_project(tmp_path))
    assert ("app/models.py::Order", "app/models.py::OrderRequest") in r.relations
    assert (
        "app/models.py::OrderRequest", "app/service.py::create_order", "param"
    ) in r.usages
    assert ("app/models.py::Order", "app/service.py::create_order", "return") in r.usages
