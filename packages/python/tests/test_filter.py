import sys
import sysconfig

import codeflowlens
from codeflowlens.tracer.filter import CodeFilter


def test_project_code_is_traced(tmp_path):
    """개요: 프로젝트 루트 아래 파일은 추적 대상인지 검증한다."""
    f = CodeFilter(tmp_path)
    assert f.should_trace(str(tmp_path / "app" / "service.py")) is True


def test_stdlib_and_site_packages_excluded(tmp_path):
    """개요: 표준 라이브러리/설치된 패키지는 추적 제외인지 검증한다."""
    f = CodeFilter(tmp_path)
    stdlib_file = sysconfig.get_paths()["stdlib"] + "/json/__init__.py"
    assert f.should_trace(stdlib_file) is False
    site = next(p for p in sys.path if "site-packages" in p)
    assert f.should_trace(site + "/requests/api.py") is False


def test_synthetic_filenames_excluded(tmp_path):
    """개요: <frozen ...>, <string> 같은 가짜 파일명은 제외인지 검증한다."""
    f = CodeFilter(tmp_path)
    assert f.should_trace("<frozen importlib._bootstrap>") is False
    assert f.should_trace("<string>") is False


def test_venv_inside_project_excluded(tmp_path):
    """개요: 프로젝트 안의 가상환경 폴더는 제외인지 검증한다."""
    f = CodeFilter(tmp_path)
    assert f.should_trace(str(tmp_path / ".venv" / "lib" / "x.py")) is False
    assert f.should_trace(str(tmp_path / "venv" / "lib" / "x.py")) is False
    assert f.should_trace(str(tmp_path / "node_modules" / "y.py")) is False


def test_codeflowlens_itself_excluded(tmp_path):
    """개요: codeflowlens 자기 자신은 추적하지 않는지 검증한다."""
    f = CodeFilter(tmp_path)
    assert f.should_trace(codeflowlens.__file__) is False
