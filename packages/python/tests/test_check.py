import textwrap

from flowlens.check_cmd import find_violations, run_check

GOOD = textwrap.dedent(
    '''
    from pydantic import BaseModel

    class Item(BaseModel):
        """개요: 상품.
        파라미터:
          - sku: 상품 코드"""
        sku: str

    def pick(sku: str):
        """개요: 상품을 고른다.
        로직: 코드로 찾는다."""
        return sku

    def _helper():
        """개요: 내부 도우미."""
        return 1
    '''
)

BAD = textwrap.dedent(
    '''
    from pydantic import BaseModel

    class Box(BaseModel):
        """개요: 상자."""
        size: int          # 파라미터 설명 없음 → 위반

    def no_doc():
        return 1           # docstring 없음 → 위반

    def only_overview(x):
        """개요: 뭔가 한다."""
        return x           # 로직 없음 → 위반

    def _quiet():
        return 2           # 헬퍼인데 개요도 없음 → 위반
    '''
)


def test_all_pass(tmp_path):
    """개요: 룰을 지킨 프로젝트는 위반이 없는지 검증한다."""
    (tmp_path / "shop.py").write_text(GOOD)
    assert find_violations(tmp_path) == []
    assert run_check(tmp_path, quiet=True) == 0


def test_violations_reported(tmp_path):
    """개요: 위반 유형별로 정확히 잡히는지 검증한다."""
    (tmp_path / "shop.py").write_text(BAD)
    violations = find_violations(tmp_path)
    by_target = {v["target"]: v["missing"] for v in violations}
    assert by_target["shop.py::no_doc"] == ["개요", "로직"]
    assert by_target["shop.py::only_overview"] == ["로직"]
    assert by_target["shop.py::_quiet"] == ["개요"]  # 헬퍼 완화: 개요만 필수
    assert by_target["shop.py::Box"] == ["파라미터(size)"]
    assert run_check(tmp_path, quiet=True) == 1


def test_test_files_relaxed(tmp_path):
    """개요: 테스트 파일 함수는 개요만 있으면 통과하는지 검증한다."""
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_x.py").write_text(
        'def test_a():\n    """개요: 검증한다."""\n    assert True\n'
    )
    assert find_violations(tmp_path) == []
