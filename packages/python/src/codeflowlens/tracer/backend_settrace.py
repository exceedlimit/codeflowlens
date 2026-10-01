"""
개요: Python 3.9~3.11용 추적 백엔드 — sys.settrace로 함수 호출 이벤트를 받는다.
로직: 'call'에서 프로젝트 코드만 골라 세션에 알리고, 'return'은 마지막 실행 명령어(opcode)로
      진짜 리턴/일시중단(yield·await)/예외 종료(unwind)를 구분해 전달한다.
참고: settrace는 이 셋을 모두 'return' 이벤트로 주기 때문에 opcode 검사가 필요하다.
      콜백 내부 오류 시 스스로 추적을 해제한다(fail-open).
"""

import inspect
import opcode
import sys
import threading

_RETURN_OPS = frozenset(
    opcode.opmap[n] for n in ("RETURN_VALUE", "RETURN_CONST") if n in opcode.opmap
)
_SUSPEND_OPS = frozenset(
    opcode.opmap[n]
    for n in ("YIELD_VALUE", "YIELD_FROM", "SEND", "RETURN_GENERATOR")
    if n in opcode.opmap
)
_GEN_FLAGS = (
    inspect.CO_GENERATOR | inspect.CO_COROUTINE | inspect.CO_ASYNC_GENERATOR
)


def _classify_return(frame) -> str:
    """
    개요: 'return' 이벤트가 진짜 리턴인지, 일시중단인지, 예외 종료인지 판정한다.
    로직: 프레임이 멈춘 위치의 opcode가 RETURN 계열이면 리턴, 제너레이터의 YIELD 계열이면
          일시중단, 둘 다 아니면 예외로 인한 종료(unwind)다.
    """
    try:
        op = frame.f_code.co_code[frame.f_lasti]
    except Exception:
        return "return"  # 판정 불가 시 스팬을 닫는 쪽이 안전하다
    if op in _RETURN_OPS:
        return "return"
    if frame.f_code.co_flags & _GEN_FLAGS and op in _SUSPEND_OPS:
        return "suspend"
    return "unwind"


class SettraceBackend:
    """개요: sys.settrace 기반 추적기 설치/해제."""

    def __init__(self, session):
        self.session = session
        self._prev = None

    def install(self):
        """개요: 현재 스레드와 이후 생성되는 스레드에 추적을 건다."""
        self._prev = sys.gettrace()
        threading.settrace(self._global)
        sys.settrace(self._global)

    def uninstall(self):
        """개요: 추적을 해제한다(설치 전 상태로 복원)."""
        sys.settrace(self._prev)
        try:
            threading.settrace(None)
        except Exception:
            pass

    def _global(self, frame, event, arg):
        """개요: 모든 함수 호출 진입점 — 프로젝트 코드만 로컬 추적을 붙인다."""
        if event != "call":
            return None
        try:
            if not self.session.filter.should_trace(frame.f_code.co_filename):
                return None
            self.session.on_call(frame)
            frame.f_trace_lines = False  # line 이벤트는 받지 않는다(성능)
            return self._local
        except Exception:
            self.uninstall()
            return None

    def _local(self, frame, event, arg):
        """개요: 추적 중인 프레임의 return/exception 이벤트 처리."""
        try:
            if event == "return":
                kind = _classify_return(frame)
                if kind == "return":
                    self.session.on_return(frame, arg)
                elif kind == "unwind":
                    self.session.on_unwind(frame)
                # suspend는 무시 — 스팬은 진짜 리턴까지 열려 있다
            elif event == "exception":
                self.session.on_exception(frame, arg[0], arg[1])
        except Exception:
            self.uninstall()
        return self._local
