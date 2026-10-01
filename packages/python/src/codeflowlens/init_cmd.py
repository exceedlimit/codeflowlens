"""
개요: `codeflowlens init` — 프로젝트에 CodeFlowLens를 이식한다(룰 셋팅 + 첫 스캔).
로직: 언어를 감지해 설정을 만들고, AGENTS.md에 주석 룰을 심고, 코딩 에이전트용
      소급 작업 스킬/작업지시서를 만들고, 프론트가 있으면 Vite 플러그인까지 연결한 뒤
      첫 정적 분석을 실행한다.
참고: 기존 파일은 보존한다 — AGENTS.md는 마커 블록만 갱신, CLAUDE.md는 참조 라인 1줄만,
      vite.config는 import 1줄 + plugins 항목 1개만(이미 있으면 건너뜀).
"""

import json
import re
from pathlib import Path

from codeflowlens.langs import detect_languages  # noqa: F401 (하위 호환 재노출)

TEMPLATES = Path(__file__).parent / "templates"
MARK_START = "<!-- codeflowlens:rules:start -->"
MARK_END = "<!-- codeflowlens:rules:end -->"
CLAUDE_REF = "@AGENTS.md 의 'CodeFlowLens 주석 룰' 섹션을 반드시 따르세요 (codeflowlens check로 검증)."
VITE_IMPORT = 'import { codeflowlensDev } from "@codeflowlens/node/vite";'


def _write_config(root: Path, langs: list):
    cfg = root / ".codeflowlens" / "config.toml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    langs_str = ", ".join(f'"{l}"' for l in langs)
    cfg.write_text(
        "# CodeFlowLens 설정\n"
        f"languages = [{langs_str}]\n"
        'exclude = []  # 추적/스캔 제외 경로 (프로젝트 루트 기준)\n'
    )


def _insert_rules_block(root: Path):
    """개요: AGENTS.md에 주석 룰 블록을 삽입(있으면 갱신)한다."""
    rules = (TEMPLATES / "agents_rules.md").read_text()
    block = f"{MARK_START}\n{rules}\n{MARK_END}"
    agents = root / "AGENTS.md"
    if agents.exists():
        text = agents.read_text()
        if MARK_START in text and MARK_END in text:
            head, rest = text.split(MARK_START, 1)
            _, tail = rest.split(MARK_END, 1)
            agents.write_text(head + block + tail)
        else:
            agents.write_text(text.rstrip() + "\n\n" + block + "\n")
    else:
        agents.write_text(block + "\n")


def _add_claude_reference(root: Path):
    """개요: CLAUDE.md가 있으면 AGENTS.md 참조 라인을 한 번만 추가한다."""
    claude = root / "CLAUDE.md"
    if not claude.exists():
        return
    text = claude.read_text()
    if "AGENTS.md" in text:
        return
    claude.write_text(text.rstrip() + "\n\n" + CLAUDE_REF + "\n")


def _write_retrofit_files(root: Path):
    skill_dir = root / ".claude" / "skills" / "codeflowlens-retrofit"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text((TEMPLATES / "retrofit_skill.md").read_text())
    (root / ".codeflowlens" / "RETROFIT.md").write_text(
        (TEMPLATES / "retrofit_guide.md").read_text()
    )


def _find_vite_configs(root: Path) -> list:
    """개요: 루트와 workspace 패키지들의 vite.config 파일을 찾는다."""
    from codeflowlens.langs import _workspace_package_files

    dirs = [root]
    pkg_file = root / "package.json"
    if pkg_file.exists():
        try:
            pkg = json.loads(pkg_file.read_text())
            dirs += [f.parent for f in _workspace_package_files(root, pkg)]
        except Exception:
            pass
    configs = []
    for d in dirs:
        for name in ("vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"):
            p = d / name
            if p.exists():
                configs.append(p)
    return configs


def _inject_vite_plugin(root: Path, langs: list) -> dict:
    """
    개요: 프론트(browser)가 있으면 vite.config에 codeflowlensDev 플러그인을 자동으로 넣는다.
    로직: import 1줄을 맨 위에, plugins 배열 첫 자리에 codeflowlensDev()를 넣는다.
          이미 들어있으면 건너뛰고, plugins 배열을 못 찾으면 손대지 않는다(보수적).
    참고: @codeflowlens/node가 설치돼 있지 않으면 주입하지 않는다 — import가 앱을 깨뜨리므로.
    """
    result = {"modified": [], "skipped": [], "note": None}
    if "browser" not in langs:
        return result
    if not (root / "node_modules" / "@codeflowlens" / "node").exists():
        result["note"] = (
            "Vite 플러그인 연결 건너뜀 — @codeflowlens/node가 설치되어 있지 않습니다. "
            "npm i -D @codeflowlens/node 후 codeflowlens init을 다시 실행하세요."
        )
        return result

    for config in _find_vite_configs(root):
        try:
            text = config.read_text()
            if "codeflowlensDev" in text:
                result["skipped"].append(str(config.relative_to(root)))
                continue
            new_text, n = re.subn(r"(plugins\s*:\s*\[)", r"\1codeflowlensDev(), ", text, count=1)
            if n == 0:
                continue  # plugins 배열을 못 찾음 — 구조가 특이하면 손대지 않는다
            config.write_text(VITE_IMPORT + "\n" + new_text)
            result["modified"].append(str(config.relative_to(root)))
        except Exception:
            continue
    return result


def _update_gitignore(root: Path):
    gi = root / ".gitignore"
    line = ".codeflowlens/"
    if gi.exists():
        if line not in gi.read_text():
            with gi.open("a") as f:
                f.write(f"\n# CodeFlowLens 추적 데이터\n{line}\n")
    else:
        gi.write_text(f"# CodeFlowLens 추적 데이터\n{line}\n")


def run_init(root=None, langs=None, quiet=False) -> int:
    """개요: init 전체 절차를 실행한다."""
    from codeflowlens.paths import find_project_root
    from codeflowlens.scan_cmd import scan

    from codeflowlens.usage_doc import ensure_usage_md

    root = Path(root or find_project_root())
    langs = langs or detect_languages(root)
    _write_config(root, langs)
    _insert_rules_block(root)
    _add_claude_reference(root)
    _write_retrofit_files(root)
    _update_gitignore(root)
    ensure_usage_md(root, force=True)
    vite = _inject_vite_plugin(root, langs)
    result = scan(root, quiet=True)

    if not quiet:
        print(f"CodeFlowLens 이식 완료 (언어: {', '.join(langs)})")
        print("  · AGENTS.md — 주석 룰 삽입")
        print("  · .claude/skills/codeflowlens-retrofit — 소급 작업 스킬")
        print("  · .codeflowlens/RETROFIT.md — 작업지시서")
        print("  · .codeflowlens/USAGE.md — 사용법 안내서")
        for path in vite["modified"]:
            print(f"  · {path} — codeflowlensDev 플러그인 연결")
        for path in vite["skipped"]:
            print(f"  · {path} — 이미 연결되어 있음")
        if vite["note"]:
            print(f"  · {vite['note']}")

        worst_coverage = 100.0
        for label, key in (("Python", "python"), ("TS/JS", "node")):
            s = result.get(key)
            if s:
                print(
                    f"  · 첫 스캔 ({label}): 함수 {s['functions']}개, "
                    f"주석 커버리지 {s['coverage']}%, 엔티티 {s['entities']}개"
                )
                worst_coverage = min(worst_coverage, s["coverage"])
        for note in result.get("notes", []):
            print(f"  · {note}")
        if worst_coverage < 100.0:
            print("\n기존 코드에 주석이 부족합니다. 코딩 에이전트에게 이렇게 시키세요:")
            print('  "codeflowlens-retrofit 스킬로 주석 소급 작업을 해줘"')
    return 0
