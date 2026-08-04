"""
개요: `flowlens check` — 비즈니스 주석 룰 준수를 기계적으로 검사한다.
로직: 정적 분석 결과를 룰(함수: 개요+로직, 엔티티: 개요+파라미터 설명)에 대조해
      위반 목록을 만들고, 위반이 있으면 종료코드 1을 돌려준다(CI 연동).
참고: 완화 룰 — '_' 시작 함수·테스트 파일·던더(__init__ 등)는 개요만 필수(PRD 6절).
"""

import json as _json

from flowlens.analyzer.pyscan import scan_project
from flowlens.paths import find_project_root


def _is_relaxed(func) -> bool:
    """개요: 완화 룰 대상(헬퍼/테스트/던더)인지 판정한다."""
    simple = func["qualified_name"].rsplit(".", 1)[-1]
    if simple.startswith("_"):  # _helper, __init__ 모두 포함
        return True
    path = func["file_path"]
    parts = path.replace("\\", "/").split("/")
    filename = parts[-1]
    return (
        "tests" in parts or "test" in parts
        or filename.startswith("test_") or filename.endswith("_test.py")
    )


def find_violations(root) -> list:
    """
    개요: 주석 룰 위반 목록을 만든다.
    로직: 함수는 개요(+완화 대상 아니면 로직), 엔티티는 개요와 모든 필드의 설명을 요구한다.
    """
    result = scan_project(root)
    violations = []
    for f in result.functions:
        missing = []
        if not f["doc"].overview:
            missing.append("개요")
        if not _is_relaxed(f) and not f["doc"].logic:
            missing.append("로직")
        if missing:
            violations.append({
                "kind": "function", "target": f["id"],
                "line": f["line"], "missing": missing,
            })
    for e in result.entities:
        missing = []
        if not e["doc"].overview:
            missing.append("개요")
        undocumented = [fl["name"] for fl in e["fields"] if not fl["description"]]
        if undocumented:
            missing.append(f"파라미터({', '.join(undocumented)})")
        if missing:
            violations.append({
                "kind": "entity", "target": e["id"],
                "line": e["line"], "missing": missing,
            })
    return violations


def run_check(root=None, as_json=False, quiet=False) -> int:
    """개요: 검사를 실행하고 결과를 출력한다. 위반 있으면 1을 돌려준다."""
    root = root or find_project_root()
    violations = find_violations(root)
    if as_json:
        print(_json.dumps({"violations": violations}, ensure_ascii=False, indent=2))
    elif not quiet:
        if not violations:
            print("통과: 모든 함수/엔티티가 주석 룰을 지키고 있습니다.")
        else:
            print(f"위반 {len(violations)}건 — 누락된 주석을 채워주세요:\n")
            for v in violations:
                label = "함수" if v["kind"] == "function" else "엔티티"
                print(f"  [{label}] {v['target']}:{v['line']} — 누락: {', '.join(v['missing'])}")
            print("\n형식 예시는 AGENTS.md의 FlowLens 주석 룰 섹션을 참고하세요.")
    return 1 if violations else 0
