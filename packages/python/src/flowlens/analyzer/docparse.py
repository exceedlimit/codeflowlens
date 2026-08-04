"""
개요: 비즈니스 주석(docstring)의 라벨을 구조화하는 파서.
로직: 줄 단위로 스캔하며 '개요:/로직:/참고:/파라미터:' (영문 별칭 포함) 라벨을 찾아
      값을 모으고, '파라미터:' 아래 '- 이름: 설명' 목록은 필드 dict로 만든다.
참고: 라벨 없는 첫 줄은 개요로 간주한다 — 기존의 한 줄 docstring도 수용하기 위함(PRD 6절).
"""

import re
from dataclasses import dataclass, field

LABEL_ALIASES = {
    "개요": "overview", "overview": "overview",
    "로직": "logic", "logic": "logic",
    "참고": "note", "note": "note",
    "파라미터": "fields", "fields": "fields", "params": "fields",
}

_LABEL_RE = re.compile(
    r"^\s*(개요|로직|참고|파라미터|Overview|Logic|Note|Fields|Params)\s*[:：]\s*(.*)$",
    re.IGNORECASE,
)
_FIELD_RE = re.compile(r"^\s*[-*]\s*([\w가-힣]+)\s*[:：]\s*(.+)$")


@dataclass
class ParsedDoc:
    """개요: 파싱된 주석 — 개요/로직/참고 텍스트와 필드 설명 목록."""

    overview: str = None
    logic: str = None
    note: str = None
    fields: dict = field(default_factory=dict)


def parse_doc(docstring) -> ParsedDoc:
    """
    개요: docstring 하나를 ParsedDoc으로 바꾼다.
    로직: 각 줄에서 라벨을 찾아 현재 섹션을 전환하고, 라벨 없는 줄은 현재 섹션 값에 이어 붙인다.
    참고: 어떤 입력에도 예외를 던지지 않는다.
    """
    result = ParsedDoc()
    if not docstring:
        return result
    try:
        sections = {"overview": [], "logic": [], "note": []}
        current = None
        for raw in docstring.strip().splitlines():
            line = raw.strip()
            if not line:
                continue
            m = _LABEL_RE.match(line)
            if m:
                current = LABEL_ALIASES[m.group(1).lower()]
                rest = m.group(2).strip()
                if current == "fields":
                    continue
                if rest:
                    sections[current].append(rest)
                continue
            if current == "fields":
                fm = _FIELD_RE.match(line)
                if fm:
                    result.fields[fm.group(1)] = fm.group(2).strip()
                continue
            if current is None:
                # 라벨 없는 도입부는 개요로 간주
                current = "overview"
            sections[current].append(line)
        result.overview = " ".join(sections["overview"]) or None
        result.logic = " ".join(sections["logic"]) or None
        result.note = " ".join(sections["note"]) or None
    except Exception:
        pass
    return result
