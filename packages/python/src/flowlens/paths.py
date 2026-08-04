"""
개요: 프로젝트 루트와 .flowlens 데이터 폴더 경로를 찾는다.
"""

from pathlib import Path

ROOT_MARKERS = ("pyproject.toml", ".git", "package.json", "requirements.txt", "setup.py")


def find_project_root(start=None) -> Path:
    """
    개요: 현재 위치에서 위로 올라가며 프로젝트 루트를 찾는다.
    로직: pyproject.toml/.git 같은 표식 파일이 있는 첫 폴더가 루트다. 없으면 시작 폴더.
    """
    start = Path(start or Path.cwd()).resolve()
    for candidate in [start, *start.parents]:
        if any((candidate / m).exists() for m in ROOT_MARKERS):
            return candidate
    return start


def db_path(project_root) -> Path:
    """개요: 프로젝트의 추적 데이터 DB 파일 경로를 돌려준다."""
    return Path(project_root) / ".flowlens" / "data.db"
