"""
개요: 배포 패키지 이름과 실행 명령(정식 이름 + 축약 cfl)이 올바르게 등록됐는지 확인한다.
참고: 사용자는 codeflowlens 와 cfl 중 어느 쪽을 쳐도 같은 CLI가 실행돼야 한다.
"""

import sys
from pathlib import Path

import pytest

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def _load_pyproject():
    """개요: pyproject.toml을 읽어 딕셔너리로 돌려준다(3.11 미만은 건너뜀)."""
    if sys.version_info < (3, 11):
        pytest.skip("tomllib은 Python 3.11+에서만 제공")
    import tomllib

    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))


def test_배포_이름은_codeflowlens():
    """개요: PyPI에 올라갈 패키지 이름이 codeflowlens인지 확인한다."""
    assert _load_pyproject()["project"]["name"] == "codeflowlens"


def test_정식_명령과_축약_명령이_같은_CLI를_실행():
    """개요: codeflowlens / cfl 두 명령이 모두 같은 진입점으로 등록됐는지 확인한다."""
    scripts = _load_pyproject()["project"]["scripts"]
    assert scripts["codeflowlens"] == "codeflowlens.cli:main"
    assert scripts["cfl"] == "codeflowlens.cli:main"


def test_도움말에_축약_명령_안내(capsys):
    """개요: --help 출력에 축약 명령 cfl 사용법이 안내되는지 확인한다."""
    from codeflowlens.cli import main

    assert main(["--help"]) == 0
    out = capsys.readouterr().out
    assert "codeflowlens" in out
    assert "cfl" in out
