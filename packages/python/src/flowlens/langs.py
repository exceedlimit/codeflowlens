"""
개요: 프로젝트가 어떤 언어를 쓰는지 알아내는 로직 (설정 파일 우선, 없으면 감지).
참고: 모노레포(workspaces) 하위 패키지의 react/vite 의존까지 봐서 browser를 감지한다.
"""

import json
import re
from pathlib import Path

BROWSER_DEPS = ("react", "vite", "next")


def _all_deps(pkg: dict) -> dict:
    return {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}


def _workspace_package_files(root: Path, pkg: dict):
    """개요: package.json의 workspaces 패턴으로 하위 패키지 package.json들을 찾는다."""
    ws = pkg.get("workspaces")
    if isinstance(ws, dict):
        ws = ws.get("packages", [])
    if not isinstance(ws, list):
        return []
    files = []
    for pattern in ws:
        try:
            for p in root.glob(str(pattern)):
                child = p / "package.json"
                if child.exists() and "node_modules" not in child.parts:
                    files.append(child)
        except Exception:
            continue
    return files


def detect_languages(root) -> list:
    """
    개요: 프로젝트에 어떤 언어가 있는지 감지한다.
    로직: pyproject/requirements → python, package.json → node,
          루트·workspace 패키지의 의존성에 react/vite/next → browser.
    """
    root = Path(root)
    langs = []
    if any((root / m).exists() for m in ("pyproject.toml", "requirements.txt", "setup.py")):
        langs.append("python")
    pkg_file = root / "package.json"
    if pkg_file.exists():
        langs.append("node")
        try:
            pkg = json.loads(pkg_file.read_text())
            pkg_files = [pkg_file, *_workspace_package_files(root, pkg)]
            for f in pkg_files:
                try:
                    deps = _all_deps(json.loads(f.read_text()))
                except Exception:
                    continue
                if any(d in deps for d in BROWSER_DEPS):
                    langs.append("browser")
                    break
        except Exception:
            pass
    return langs or ["python"]


def read_languages(root) -> list:
    """개요: .flowlens/config.toml의 languages를 읽고, 없으면 감지한다."""
    try:
        text = (Path(root) / ".flowlens" / "config.toml").read_text()
        m = re.search(r"languages\s*=\s*\[([^\]]*)\]", text)
        if m:
            langs = re.findall(r'"([^"]+)"', m.group(1))
            if langs:
                return langs
    except Exception:
        pass
    return detect_languages(root)
