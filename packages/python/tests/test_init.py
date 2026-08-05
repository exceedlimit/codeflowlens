from flowlens.init_cmd import run_init


def make_project(tmp_path):
    (tmp_path / "requirements.txt").write_text("fastapi\n")
    (tmp_path / "app.py").write_text(
        'def hello():\n    """개요: 인사한다.\n    로직: 문자열을 만든다."""\n    return "hi"\n'
    )
    return tmp_path


def test_init_creates_everything(tmp_path):
    """개요: init이 설정/룰/스킬/작업지시서를 만들고 첫 스캔까지 하는지 검증한다."""
    root = make_project(tmp_path)
    assert run_init(root, quiet=True) == 0

    assert (root / ".flowlens" / "config.toml").exists()
    assert "python" in (root / ".flowlens" / "config.toml").read_text()

    agents = (root / "AGENTS.md").read_text()
    assert "<!-- flowlens:rules:start -->" in agents
    assert "개요" in agents and "로직" in agents

    assert (root / ".claude" / "skills" / "flowlens-retrofit" / "SKILL.md").exists()
    assert (root / ".flowlens" / "RETROFIT.md").exists()
    assert ".flowlens/" in (root / ".gitignore").read_text()
    assert (root / ".flowlens" / "data.db").exists()  # 첫 스캔 실행됨

    usage = (root / ".flowlens" / "USAGE.md").read_text()
    assert "FlowLens 사용법" in usage
    assert "flowlens run" in usage and "flowlens check" in usage


def test_scan_and_run_also_create_usage_md(tmp_path):
    """개요: init 없이 scan만 해도 사용법 안내서가 생기는지 검증한다(설치 즉시 발견 가능)."""
    from flowlens.scan_cmd import scan

    root = make_project(tmp_path)
    scan(root, quiet=True)
    assert (root / ".flowlens" / "USAGE.md").exists()


def test_usage_md_user_edit_preserved_but_init_refreshes(tmp_path):
    """개요: run/scan은 기존 USAGE.md를 보존하고, init은 최신 내용으로 갱신하는지 검증한다."""
    from flowlens.scan_cmd import scan

    root = make_project(tmp_path)
    scan(root, quiet=True)
    (root / ".flowlens" / "USAGE.md").write_text("사용자 수정본")
    scan(root, quiet=True)  # scan은 덮어쓰지 않는다
    assert (root / ".flowlens" / "USAGE.md").read_text() == "사용자 수정본"
    run_init(root, quiet=True)  # init은 최신 안내서로 갱신한다
    assert "FlowLens 사용법" in (root / ".flowlens" / "USAGE.md").read_text()


def test_init_preserves_existing_agents_md(tmp_path):
    """개요: 기존 AGENTS.md 내용을 보존하고 재실행 시 블록만 갱신되는지 검증한다."""
    root = make_project(tmp_path)
    (root / "AGENTS.md").write_text("# 우리 팀 규칙\n\n기존 내용.\n")
    run_init(root, quiet=True)
    run_init(root, quiet=True)  # 재실행

    agents = (root / "AGENTS.md").read_text()
    assert "기존 내용." in agents
    assert agents.count("<!-- flowlens:rules:start -->") == 1


def test_init_adds_claude_md_reference_once(tmp_path):
    """개요: CLAUDE.md가 있으면 AGENTS.md 참조 라인을 한 번만 추가하는지 검증한다."""
    root = make_project(tmp_path)
    (root / "CLAUDE.md").write_text("# 프로젝트 가이드\n")
    run_init(root, quiet=True)
    run_init(root, quiet=True)

    claude = (root / "CLAUDE.md").read_text()
    assert claude.count("AGENTS.md") == 1


def test_init_lang_option(tmp_path):
    """개요: --lang 지정이 config에 반영되는지 검증한다."""
    root = make_project(tmp_path)
    run_init(root, langs=["python"], quiet=True)
    cfg = (root / ".flowlens" / "config.toml").read_text()
    assert '"python"' in cfg and '"node"' not in cfg


def test_init_detects_node_and_browser(tmp_path):
    """개요: package.json과 react 의존이 있으면 node/browser가 감지되는지 검증한다."""
    root = make_project(tmp_path)
    (root / "package.json").write_text('{"dependencies": {"react": "^19.0.0"}}')
    run_init(root, quiet=True)
    cfg = (root / ".flowlens" / "config.toml").read_text()
    assert '"node"' in cfg and '"browser"' in cfg
