"""
개요: 파라미터/리턴값을 저장 가능한 JSON 문자열로 바꾸는 직렬화기.
참고: 어떤 입력에도 예외를 밖으로 던지지 않는다(fail-open) — 추적기는 앱을 죽이면 안 된다.
"""

import json

DEFAULT_MAX_BYTES = 65536
TRUNCATED_MARK = "...(truncated)"


def _fallback(o):
    """
    개요: JSON이 모르는 객체를 저장 가능한 형태로 바꾼다.
    로직: 공개 필드가 있으면 타입명+필드로, 없으면 repr 문자열로 대체한다.
    """
    d = getattr(o, "__dict__", None)
    if isinstance(d, dict):
        out = {"__type__": type(o).__name__}
        for i, (k, v) in enumerate(d.items()):
            if i >= 50:
                break
            if not str(k).startswith("_"):
                out[k] = v
        return out
    return {"__repr__": repr(o)[:1000]}


def _cap(s: str, max_bytes: int) -> str:
    """개요: 크기 상한을 넘는 문자열을 잘라내고 표식을 붙인다."""
    if len(s.encode("utf-8", "ignore")) > max_bytes:
        return s.encode("utf-8", "ignore")[:max_bytes].decode("utf-8", "ignore") + TRUNCATED_MARK
    return s


def serialize_value(value, max_bytes: int = DEFAULT_MAX_BYTES) -> str:
    """
    개요: 값 하나를 저장 가능한 JSON 문자열로 바꾼다.
    로직: JSON 변환을 시도하고, 안 되는 객체는 타입명+필드 또는 repr로 대체한 뒤 크기 상한을 적용한다.
    참고: 순환 참조 등 어떤 입력에도 예외를 던지지 않는다.
    """
    try:
        s = json.dumps(value, ensure_ascii=False, default=_fallback)
    except Exception:
        try:
            s = json.dumps({"__repr__": repr(value)[:1000]}, ensure_ascii=False)
        except Exception:
            s = '{"__repr__": "<unserializable>"}'
    return _cap(s, max_bytes)


def serialize_args(frame_locals: dict, argnames, max_bytes: int = DEFAULT_MAX_BYTES) -> str:
    """
    개요: 함수 인자들을 {인자명: 값} JSON으로 바꾼다.
    로직: 인자별로 개별 직렬화해서 인자 하나가 커도 다른 인자를 살린다.
    참고: argnames에 없는 로컬 변수는 저장하지 않는다.
    """
    try:
        parts = []
        for name in argnames:
            if name in frame_locals:
                v = serialize_value(frame_locals[name], max_bytes)
                parts.append(json.dumps(str(name), ensure_ascii=False) + ": " + _ensure_json(v))
        return "{" + ", ".join(parts) + "}"
    except Exception:
        return "{}"


def _ensure_json(s: str) -> str:
    """개요: 잘린 값처럼 JSON이 깨진 문자열도 유효한 JSON 값으로 감싼다."""
    try:
        json.loads(s)
        return s
    except Exception:
        return json.dumps(s, ensure_ascii=False)
