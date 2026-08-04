"""
개요: "내 프로젝트 코드만 추적"을 판정하는 필터.
참고: 라이브러리 내부까지 추적하면 노이즈와 오버헤드가 커지므로 기본은 프로젝트 코드만 잡는다(PRD 7절).
"""

import os
import sys
import sysconfig
from pathlib import Path

EXCLUDED_DIR_NAMES = {".venv", "venv", "env", "node_modules", "site-packages", "__pypackages__"}


class CodeFilter:
    """
    개요: 파일 경로가 추적 대상인지 판정한다.
    로직: 프로젝트 루트 하위이면서, 파이썬 설치 경로·가상환경·flowlens 자신이 아니면 대상이다.
    참고: 판정 결과는 파일별로 캐시된다(추적 콜백은 매우 자주 불리므로).
    """

    def __init__(self, project_root):
        self._root = str(Path(project_root).resolve()) + os.sep
        self._cache = {}
        self._flowlens_dir = str(Path(__file__).resolve().parents[1]) + os.sep
        prefixes = {
            sys.prefix, sys.exec_prefix,
            getattr(sys, "base_prefix", sys.prefix),
            getattr(sys, "base_exec_prefix", sys.exec_prefix),
            sysconfig.get_paths().get("stdlib", ""),
        }
        self._sys_prefixes = tuple(str(Path(p).resolve()) + os.sep for p in prefixes if p)

    def should_trace(self, filename: str) -> bool:
        """개요: 이 파일의 함수를 추적할지 여부를 돌려준다."""
        cached = self._cache.get(filename)
        if cached is not None:
            return cached
        result = self._decide(filename)
        self._cache[filename] = result
        return result

    def _decide(self, filename: str) -> bool:
        if not filename or filename.startswith("<"):
            return False
        try:
            path = str(Path(filename).resolve())
        except Exception:
            return False
        if path.startswith(self._flowlens_dir):
            return False
        for p in self._sys_prefixes:
            if path.startswith(p):
                return False
        if not path.startswith(self._root):
            return False
        rel = path[len(self._root):]
        parts = rel.split(os.sep)
        if any(part in EXCLUDED_DIR_NAMES for part in parts):
            return False
        return True
