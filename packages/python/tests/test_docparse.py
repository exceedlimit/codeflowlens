from codeflowlens.analyzer.docparse import parse_doc


def test_three_labels_parsed():
    """개요: 개요/로직/참고 라벨이 각각 파싱되는지 검증한다."""
    doc = """
    개요: 재고 수량을 추가한다.
    로직: 현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다.
    참고: 재고는 음수가 될 수 없다.
    """
    d = parse_doc(doc)
    assert d.overview == "재고 수량을 추가한다."
    assert d.logic == "현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다."
    assert d.note == "재고는 음수가 될 수 없다."


def test_plain_first_line_becomes_overview():
    """개요: 라벨 없는 한 줄 docstring은 개요로 간주되는지 검증한다(기존 코드 수용)."""
    d = parse_doc("주문을 생성한다.")
    assert d.overview == "주문을 생성한다."
    assert d.logic is None and d.note is None


def test_english_aliases():
    """개요: 영문 라벨(Overview/Logic/Note)도 동작하는지 검증한다."""
    d = parse_doc("Overview: add stock.\nLogic: read then write.\nNote: never negative.")
    assert d.overview == "add stock."
    assert d.logic == "read then write."
    assert d.note == "never negative."


def test_fields_list_parsed():
    """개요: '파라미터:' 아래 필드 목록이 dict로 파싱되는지 검증한다."""
    doc = """
    개요: 주문 정보를 담는 엔티티.
    파라미터:
      - order_id: 주문 번호
      - quantity: 주문 수량
    참고: 취소되면 quantity가 0이 된다.
    """
    d = parse_doc(doc)
    assert d.fields == {"order_id": "주문 번호", "quantity": "주문 수량"}
    assert d.note == "취소되면 quantity가 0이 된다."


def test_multiline_value_joined():
    """개요: 라벨 값이 여러 줄이면 다음 라벨 전까지 이어 붙는지 검증한다."""
    doc = """
    개요: 주문을 생성한다.
    로직: 재고를 확인하고,
      부족하면 오류를 낸다.
      충분하면 저장한다.
    """
    d = parse_doc(doc)
    assert d.logic == "재고를 확인하고, 부족하면 오류를 낸다. 충분하면 저장한다."


def test_none_docstring():
    """개요: docstring이 없으면 전부 None인지 검증한다."""
    d = parse_doc(None)
    assert d.overview is None and d.logic is None and d.note is None and d.fields == {}


def test_labels_any_order():
    """개요: 라벨 순서가 뒤섞여도 각자 파싱되는지 검증한다."""
    d = parse_doc("참고: 주의.\n개요: 무언가 한다.")
    assert d.overview == "무언가 한다."
    assert d.note == "주의."
