import json
import socket
from dataclasses import dataclass

from flowlens.tracer.serialize import serialize_args, serialize_value


def test_plain_values_roundtrip():
    """개요: 기본 타입(dict/list/str/int)이 JSON 그대로 저장되는지 검증한다."""
    assert json.loads(serialize_value({"a": 1})) == {"a": 1}
    assert json.loads(serialize_value([1, "x"])) == [1, "x"]
    assert json.loads(serialize_value("한글")) == "한글"
    assert json.loads(serialize_value(None)) is None


def test_object_with_dict_serialized_with_type():
    """개요: 일반 객체(dataclass 등)는 타입명 + 공개 필드로 저장되는지 검증한다."""

    @dataclass
    class Order:
        order_id: str
        qty: int

    out = json.loads(serialize_value(Order("o-1", 3)))
    assert out["__type__"] == "Order"
    assert out["order_id"] == "o-1"
    assert out["qty"] == 3


def test_unserializable_falls_back_to_repr():
    """개요: JSON도 __dict__도 안 되는 객체(소켓 등)는 repr로 저장되는지 검증한다."""
    s = socket.socket()
    try:
        out = json.loads(serialize_value(s))
        assert "__repr__" in out
    finally:
        s.close()


def test_size_cap_truncates():
    """개요: 크기 상한을 넘는 값은 잘리고 truncated 표식이 붙는지 검증한다."""
    big = "x" * 100_000
    out = serialize_value(big, max_bytes=1000)
    assert len(out.encode()) < 1100
    assert out.endswith("...(truncated)")


def test_circular_reference_never_raises():
    """개요: 순환 참조 입력에도 예외가 밖으로 나가지 않는지 검증한다(fail-open)."""
    a = {}
    a["self"] = a
    out = serialize_value(a)  # 예외 없이 문자열 반환이면 성공
    assert isinstance(out, str)


def test_serialize_args_per_param():
    """개요: 인자별로 개별 직렬화되어 하나가 커도 나머지가 살아있는지 검증한다."""
    out = json.loads(
        serialize_args({"small": 1, "big": "y" * 100_000, "self": object()},
                       ["small", "big"], max_bytes=1000)
    )
    assert out["small"] == 1
    assert out["big"].endswith("...(truncated)")
    assert "self" not in out  # argnames에 없는 로컬 변수는 제외
