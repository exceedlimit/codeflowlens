"""
개요: `cfl ui` 명령이 모니터링 화면을 띄울 실행 명령을 올바르게 고르는지 확인한다.
로직: 프로젝트에 설치된 UI → PATH의 UI → npx 순으로 찾고, DB는 프로젝트의 .codeflowlens/data.db를 기본으로 넘긴다.
"""

from codeflowlens.ui_cmd import build_ui_command


def _which_from(table):
    """개요: 지정한 명령만 PATH에 있는 것처럼 흉내 내는 which 대역."""
    return lambda name: table.get(name)


def test_npx로_UI를_내려받아_실행(tmp_path):
    """개요: 설치된 UI가 없으면 npx로 @codeflowlens/ui를 실행하고 프로젝트 DB를 넘긴다."""
    cmd = build_ui_command(tmp_path, [], which=_which_from({"npx": "/usr/bin/npx"}))
    assert cmd == [
        "/usr/bin/npx", "-y", "@codeflowlens/ui",
        "--db", str(tmp_path / ".codeflowlens" / "data.db"),
    ]


def test_프로젝트에_설치된_UI를_우선_사용(tmp_path):
    """개요: 프로젝트 node_modules에 UI가 있으면 내려받지 않고 그것을 쓴다."""
    local = tmp_path / "node_modules" / ".bin" / "codeflowlens-ui"
    local.parent.mkdir(parents=True)
    local.write_text("")
    cmd = build_ui_command(tmp_path, [], which=_which_from({"npx": "/usr/bin/npx"}))
    assert cmd[0] == str(local)


def test_PATH에_설치된_UI를_npx보다_먼저_사용(tmp_path):
    """개요: 전역 설치된 codeflowlens-ui가 있으면 npx보다 먼저 쓴다."""
    which = _which_from({"codeflowlens-ui": "/opt/bin/codeflowlens-ui", "npx": "/usr/bin/npx"})
    assert build_ui_command(tmp_path, [], which=which)[0] == "/opt/bin/codeflowlens-ui"


def test_사용자가_준_인자는_그대로_전달(tmp_path):
    """개요: --db/--port를 직접 주면 기본 DB를 덧붙이지 않고 그대로 넘긴다."""
    which = _which_from({"npx": "npx"})
    cmd = build_ui_command(tmp_path, ["--db", "x.db", "--port", "9000"], which=which)
    assert cmd[-4:] == ["--db", "x.db", "--port", "9000"]
    assert cmd.count("--db") == 1


def test_Node가_없으면_None(tmp_path):
    """개요: UI도 npx도 없으면 None을 돌려 호출부가 Node 설치 안내를 하게 한다."""
    assert build_ui_command(tmp_path, [], which=_which_from({})) is None
