"""
개요: Python 3.12+용 추적 백엔드 — 공식 저오버헤드 API인 sys.monitoring을 사용한다.
로직: PY_START(호출)/PY_RETURN(리턴)/PY_UNWIND(예외 종료) 이벤트를 세션에 전달한다.
      비프로젝트 코드는 DISABLE을 반환해 해당 코드객체의 이벤트를 영구 차단한다(저오버헤드 핵심).
참고: settrace와 달리 일시중단(PY_YIELD)과 리턴이 구분된 이벤트라 opcode 검사가 필요 없다.
      콜백 내부 오류 시 스스로 추적을 해제한다(fail-open).
"""

import sys

TOOL_ID = 5  # sys.monitoring 도구 슬롯(0~5 중 PROFILER_ID 등과 겹치지 않는 값)


class MonitoringBackend:
    """개요: sys.monitoring 기반 추적기 설치/해제."""

    def __init__(self, session):
        self.session = session
        self._mon = sys.monitoring

    def install(self):
        """개요: 모니터링 콜백을 등록한다(모든 스레드에 적용)."""
        mon = self._mon
        try:
            mon.use_tool_id(TOOL_ID, "codeflowlens")
        except ValueError:
            mon.free_tool_id(TOOL_ID)
            mon.use_tool_id(TOOL_ID, "codeflowlens")
        mon.register_callback(TOOL_ID, mon.events.PY_START, self._on_start)
        mon.register_callback(TOOL_ID, mon.events.PY_RETURN, self._on_return)
        mon.register_callback(TOOL_ID, mon.events.PY_UNWIND, self._on_unwind)
        mon.set_events(
            TOOL_ID,
            mon.events.PY_START | mon.events.PY_RETURN | mon.events.PY_UNWIND,
        )

    def uninstall(self):
        """개요: 모니터링을 해제한다."""
        try:
            self._mon.set_events(TOOL_ID, 0)
            self._mon.free_tool_id(TOOL_ID)
        except Exception:
            pass

    # --- 콜백 (frame은 sys._getframe(1) == 감시 대상 프레임) -------------

    def _on_start(self, code, instruction_offset):
        try:
            if not self.session.filter.should_trace(code.co_filename):
                return self._mon.DISABLE  # 이 코드객체는 다시 묻지 않는다
            self.session.on_call(sys._getframe(1))
        except Exception:
            self.uninstall()
        return None

    def _on_return(self, code, instruction_offset, retval):
        try:
            if not self.session.filter.should_trace(code.co_filename):
                return self._mon.DISABLE
            self.session.on_return(sys._getframe(1), retval)
        except Exception:
            self.uninstall()
        return None

    def _on_unwind(self, code, instruction_offset, exception):
        try:
            if not self.session.filter.should_trace(code.co_filename):
                return None  # PY_UNWIND는 DISABLE 불가 이벤트
            self.session.on_unwind(sys._getframe(1), exception)
        except Exception:
            self.uninstall()
        return None
