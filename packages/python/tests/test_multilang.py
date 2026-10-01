import json
import os
import stat
import textwrap

from codeflowlens.check_cmd import run_check
from codeflowlens.init_cmd import run_init
from codeflowlens.langs import detect_languages
from codeflowlens.scan_cmd import scan


def make_monorepo(tmp_path, with_node_cli=True):
    """개요: workspaces + react 하위 패키지를 가진 TS 모노레포 픽스처를 만든다."""
    (tmp_path / "package.json").write_text(
        json.dumps({"name": "mono", "workspaces": ["packages/*"]})
    )
    web = tmp_path / "packages" / "web"
    web.mkdir(parents=True)
    (web / "package.json").write_text(
        json.dumps({"name": "web", "dependencies": {"react": "^19.0.0"}})
    )
    (web / "vite.config.ts").write_text(
        textwrap.dedent(
            """
            import { defineConfig } from "vite";
            import react from "@vitejs/plugin-react";

            export default defineConfig({
              plugins: [react()],
              server: { port: 5173 },
            });
            """
        ).lstrip()
    )
    if with_node_cli:
        # 가짜 @codeflowlens/node 설치 흔적 + 가짜 Node CLI (호출 기록을 남긴다)
        (tmp_path / "node_modules" / "@codeflowlens" / "node").mkdir(parents=True)
        bin_dir = tmp_path / "node_modules" / ".bin"
        bin_dir.mkdir(parents=True)
        fake = bin_dir / "codeflowlens"
        fake.write_text(
            "#!/bin/sh\n"
            f"echo \"$@\" >> {tmp_path}/node-cli-calls.log\n"
            'if [ "$1" = "scan" ]; then\n'
            '  echo "스캔 완료: 함수 7개 (주석 있음 3개, 커버리지 42.9%), 엔티티 2개"\n'
            "else\n"
            '  echo "위반 4건 (TS/JS)"\n'
            "  exit 1\n"
            "fi\n"
        )
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return tmp_path


def test_detect_languages_sees_workspace_react(tmp_path):
    """개요: 루트가 아닌 workspace 패키지의 react 의존도 browser로 감지되는지 검증한다."""
    make_monorepo(tmp_path)
    assert detect_languages(tmp_path) == ["node", "browser"]


def test_scan_delegates_to_node_cli(tmp_path):
    """개요: node 언어 프로젝트의 scan이 Node CLI에 위임되고 요약이 파싱되는지 검증한다."""
    root = make_monorepo(tmp_path)
    run_init(root, quiet=True)
    result = scan(root, quiet=True)
    assert result["python"] is None  # 파이썬 없는 프로젝트 — 내장 스캐너는 건너뜀
    assert result["node"] == {
        "functions": 7, "documented": 3, "coverage": 42.9, "entities": 2,
    }
    assert "scan" in (root / "node-cli-calls.log").read_text()


def test_scan_notes_when_node_cli_missing(tmp_path):
    """개요: @codeflowlens/node 미설치면 안내 문구를 담는지 검증한다."""
    root = make_monorepo(tmp_path, with_node_cli=False)
    result = scan(root, quiet=True)
    assert result["node"] is None
    assert any("@codeflowlens/node" in n for n in result["notes"])


def test_check_combines_node_exit_code(tmp_path):
    """개요: Node 쪽 check가 위반이면 전체 종료코드가 1이 되는지 검증한다."""
    root = make_monorepo(tmp_path)
    run_init(root, quiet=True)
    assert run_check(root, quiet=True) == 1
    assert "check" in (root / "node-cli-calls.log").read_text()


def test_init_injects_vite_plugin(tmp_path):
    """개요: init이 vite.config에 import와 플러그인을 자동 추가하는지 검증한다."""
    root = make_monorepo(tmp_path)
    run_init(root, quiet=True)
    text = (root / "packages" / "web" / "vite.config.ts").read_text()
    assert text.startswith('import { codeflowlensDev } from "@codeflowlens/node/vite";')
    assert "plugins: [codeflowlensDev(), react()]" in text

    # 재실행해도 중복 삽입되지 않는다
    run_init(root, quiet=True)
    text2 = (root / "packages" / "web" / "vite.config.ts").read_text()
    assert text2.count("codeflowlensDev()") == 1
    assert text2.count("@codeflowlens/node/vite") == 1


def test_init_skips_vite_injection_without_package(tmp_path):
    """개요: @codeflowlens/node 미설치면 vite.config를 건드리지 않는지 검증한다(깨짐 방지)."""
    root = make_monorepo(tmp_path, with_node_cli=False)
    before = (root / "packages" / "web" / "vite.config.ts").read_text()
    run_init(root, quiet=True)
    assert (root / "packages" / "web" / "vite.config.ts").read_text() == before
