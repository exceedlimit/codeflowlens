"""
개요: `flowlens init` — 프로젝트에 FlowLens를 이식한다(룰 셋팅 + 첫 스캔).
로직: 언어를 감지해 설정을 만들고, AGENTS.md에 주석 룰을 심고, 코딩 에이전트용
      소급 작업 스킬/작업지시서를 만든 뒤 첫 정적 분석을 실행한다.
참고: 기존 파일은 보존한다 — AGENTS.md는 마커 블록만 갱신, CLAUDE.md는 참조 라인 1줄만.
      사용자 코드 자체는 절대 건드리지 않는다(PRD 4절 시나리오 1).
"""

import json
from pathlib import Path

TEMPLATES = Path(__file__).parent / "templates"
MARK_START = "<!-- flowlens:rules:start -->"
MARK_END = "<!-- flowlens:rules:end -->"
CLAUDE_REF = "@AGENTS.md 의 'FlowLens 주석 룰' 섹션을 반드시 따르세요 (flowlens check로 검증)."


def detect_languages(root: Path) -> list:
    """
    개요: 프로젝트에 어떤 언어가 있는지 감지한다.
    로직: pyproject/requirements → python, package.json → node,
          package.json 의존성에 react/vite → browser.
    """
    langs = []
    if any((root / m).exists() for m in ("pyproject.toml", "requirements.txt", "setup.py")):
        langs.append("python")
    pkg = root / "package.json"
    if pkg.exists():
        langs.append("node")
        try:
            deps = json.loads(pkg.read_text())
            all_deps = {**deps.get("dependencies", {}), **deps.get("devDependencies", {})}
            if any(d in all_deps for d in ("react", "vite", "next")):
                langs.append("browser")
        except Exception:
            pass
    return langs or ["python"]


def _write_config(root: Path, langs: list):
    cfg = root / ".flowlens" / "config.toml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    langs_str = ", ".join(f'"{l}"' for l in langs)
    cfg.write_text(
        "# FlowLens 설정\n"
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
    skill_dir = root / ".claude" / "skills" / "flowlens-retrofit"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text((TEMPLATES / "retrofit_skill.md").read_text())
    (root / ".flowlens" / "RETROFIT.md").write_text(
        (TEMPLATES / "retrofit_guide.md").read_text()
    )


def _update_gitignore(root: Path):
    gi = root / ".gitignore"
    line = ".flowlens/"
    if gi.exists():
        if line not in gi.read_text():
            with gi.open("a") as f:
                f.write(f"\n# FlowLens 추적 데이터\n{line}\n")
    else:
        gi.write_text(f"# FlowLens 추적 데이터\n{line}\n")


def run_init(root=None, langs=None, quiet=False) -> int:
    """개요: init 전체 절차를 실행한다."""
    from flowlens.paths import find_project_root
    from flowlens.scan_cmd import scan

    from flowlens.usage_doc import ensure_usage_md

    root = Path(root or find_project_root())
    langs = langs or detect_languages(root)
    _write_config(root, langs)
    _insert_rules_block(root)
    _add_claude_reference(root)
    _write_retrofit_files(root)
    _update_gitignore(root)
    ensure_usage_md(root, force=True)
    summary = scan(root, quiet=True)

    if not quiet:
        print(f"FlowLens 이식 완료 (언어: {', '.join(langs)})")
        print("  · AGENTS.md — 주석 룰 삽입")
        print("  · .claude/skills/flowlens-retrofit — 소급 작업 스킬")
        print("  · .flowlens/RETROFIT.md — 작업지시서")
        print("  · .flowlens/USAGE.md — 사용법 안내서")
        print(
            f"  · 첫 스캔: 함수 {summary['functions']}개, "
            f"주석 커버리지 {summary['coverage']}%, 엔티티 {summary['entities']}개"
        )
        if summary["coverage"] < 100.0:
            print("\n기존 코드에 주석이 부족합니다. 코딩 에이전트에게 이렇게 시키세요:")
            print('  "flowlens-retrofit 스킬로 주석 소급 작업을 해줘"')
    return 0
