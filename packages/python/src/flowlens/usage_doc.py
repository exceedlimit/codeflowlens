"""
개요: 사용법 안내서(.flowlens/USAGE.md)를 프로젝트에 저장한다.
로직: init은 항상 최신 내용으로 갱신하고, run/scan은 없을 때만 만들어 사용자 수정본을 보존한다.
참고: FlowLens를 처음 접하는 팀원이 .flowlens 폴더만 열어봐도 쓰는 법을 알 수 있게 하기 위함.
"""

from pathlib import Path

TEMPLATE = Path(__file__).parent / "templates" / "usage_guide.md"


def ensure_usage_md(project_root, force: bool = False) -> None:
    """
    개요: 프로젝트의 .flowlens/USAGE.md를 만든다.
    로직: force면 덮어쓰고, 아니면 파일이 없을 때만 쓴다. 실패해도 조용히 넘어간다(fail-open).
    """
    try:
        target = Path(project_root) / ".flowlens" / "USAGE.md"
        if target.exists() and not force:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(TEMPLATE.read_text())
    except Exception:
        pass  # 안내서 생성 실패가 추적/스캔을 막으면 안 된다
