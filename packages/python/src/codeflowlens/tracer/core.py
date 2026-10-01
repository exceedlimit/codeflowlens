"""
개요: 실행 1건(트레이스)의 스팬들을 조립해 writer로 보내는 세션.
로직: 백엔드(settrace/monitoring)가 알려주는 call/return/unwind 이벤트를 받아,
      frame→스팬 맵으로 부모를 찾아 호출 트리를 만든다.
참고: 부모 = 가장 가까운 "추적된 조상 frame"의 스팬. 조상이 없으면(스레드/태스크 경계)
      트레이스 루트 직속이 된다. 모든 공개 메서드는 예외를 밖으로 던지지 않는다(fail-open).
"""

import contextvars
import itertools
import json
import os
import time
import uuid
from pathlib import Path

from codeflowlens.tracer.serialize import serialize_args, serialize_value

# 개요: 현재 실행 흐름(asyncio 태스크/스레드)이 속한 트레이스 id.
# 참고: ASGI 요청 그룹핑이 요청마다 값을 바꾼다. None이면 프로세스 기본 트레이스.
_current_trace = contextvars.ContextVar("codeflowlens_current_trace", default=None)

# 추적 제외 진입점의 요청 동안 설정되는 값 — 이 흐름의 스팬은 기록하지 않는다
DISCARD = "__codeflowlens_discard__"


class TraceSession:
    """개요: 트레이스 1건의 수명(시작→스팬 수집→종료)을 관리한다."""

    def __init__(self, writer, code_filter, project_root,
                 entry_kind, entry_name, service="python",
                 http_method=None, http_path=None, client_trace_id=None,
                 value_max_bytes=65536):
        self.writer = writer
        self.filter = code_filter
        self._root = str(Path(project_root).resolve()) + os.sep
        self._max_bytes = value_max_bytes
        self.trace_id = uuid.uuid4().hex  # 프로세스 기본 트레이스
        self._seq = itertools.count()
        self._frames = {}      # id(frame) -> 진행 중 스팬 기록
        self._fid_cache = {}   # code object -> (function_id, qualname)
        writer.trace_start({
            "id": self.trace_id, "started_at": time.time(),
            "entry_kind": entry_kind, "entry_name": entry_name,
            "http_method": http_method, "http_path": http_path,
            "source": "backend", "client_trace_id": client_trace_id,
            "service": service,
        })

    # --- 백엔드가 호출하는 이벤트 ---------------------------------------

    def on_call(self, frame):
        """
        개요: 함수 호출 시작을 기록한다.
        로직: 부모 스팬을 frame 체인에서 찾고, 인자를 그 시점 값으로 직렬화해 보관한다.
        참고: 제너레이터/코루틴이 재개될 때는 이미 스팬이 있으므로 건너뛴다.
        """
        trace_id = _current_trace.get() or self.trace_id
        if trace_id == DISCARD:
            return  # 추적 제외 진입점의 요청 — 스팬을 남기지 않는다
        key = id(frame)
        if key in self._frames:
            return
        code = frame.f_code
        function_id, qualname = self._identify(code, frame)
        parent = self._find_parent(frame)
        argnames = code.co_varnames[: code.co_argcount + code.co_kwonlyargcount]
        rec = {
            "span_id": uuid.uuid4().hex,
            "trace_id": trace_id,
            "function_id": function_id,
            "name": qualname,
            "started_at": time.time(),
            "args_json": serialize_args(frame.f_locals, argnames, self._max_bytes),
            "parent_id": parent["span_id"] if parent else None,
            "seq": next(self._seq),
            "pending_exc": None,
        }
        self._frames[key] = rec
        if parent:
            self.writer.runtime_edge(parent["function_id"], function_id)

    def on_return(self, frame, retval):
        """개요: 함수가 정상 리턴했다 — 스팬을 완성해 기록한다(내부에서 예외를 잡았어도 ok)."""
        rec = self._frames.pop(id(frame), None)
        if rec is None:
            return
        self._emit(rec, status="ok",
                   return_json=serialize_value(retval, self._max_bytes),
                   error_json=None)

    def on_unwind(self, frame, exc=None):
        """개요: 함수가 예외로 종료됐다 — 스팬을 error로 기록한다."""
        rec = self._frames.pop(id(frame), None)
        if rec is None:
            return
        if exc is None and rec["pending_exc"] is not None:
            exc_type, exc_value = rec["pending_exc"]
        elif exc is not None:
            exc_type, exc_value = type(exc), exc
        else:
            exc_type, exc_value = Exception, None
        error_json = json.dumps({
            "type": getattr(exc_type, "__name__", str(exc_type)),
            "message": str(exc_value)[:1000],
        }, ensure_ascii=False)
        self._emit(rec, status="error", return_json=None, error_json=error_json)

    def on_exception(self, frame, exc_type, exc_value):
        """개요: 프레임에 예외가 지나갔다고 표시만 해둔다(unwind 시 사용, settrace 전용)."""
        rec = self._frames.get(id(frame))
        if rec is not None:
            rec["pending_exc"] = (exc_type, exc_value)

    def finish(self, status="ok", http_status=None):
        """개요: 프로세스 기본 트레이스를 종료 상태로 기록한다."""
        self.writer.trace_end(self.trace_id, time.time(), status, http_status)

    # --- 요청 단위 트레이스 (ASGI 그룹핑이 사용) -------------------------

    def begin_request_trace(self, entry_name, http_method=None, http_path=None,
                            client_trace_id=None):
        """
        개요: 새 요청 트레이스를 시작하고 현재 실행 흐름을 그 트레이스로 전환한다.
        로직: 트레이스 행을 기록하고 contextvar를 바꾼다 — 이후 이 태스크의 스팬은
              모두 이 트레이스에 담긴다.
        """
        trace_id = uuid.uuid4().hex
        self.writer.trace_start({
            "id": trace_id, "started_at": time.time(),
            "entry_kind": "http", "entry_name": entry_name,
            "http_method": http_method, "http_path": http_path,
            "source": "backend", "client_trace_id": client_trace_id,
            "service": "python",
        })
        token = _current_trace.set(trace_id)
        return token, trace_id

    def end_request_trace(self, token, trace_id, status, http_status=None):
        """개요: 요청 트레이스를 닫고 실행 흐름을 원래 트레이스로 되돌린다."""
        try:
            _current_trace.reset(token)
        except Exception:
            pass
        self.writer.trace_end(trace_id, time.time(), status, http_status)

    def begin_discard(self):
        """개요: 추적 제외 요청 시작 — 이 흐름의 스팬 기록을 끈다."""
        return _current_trace.set(DISCARD)

    def end_discard(self, token):
        """개요: 추적 제외 요청 종료 — 원래 트레이스로 되돌린다."""
        try:
            _current_trace.reset(token)
        except Exception:
            pass

    # --- 내부 구현 ------------------------------------------------------

    def _emit(self, rec, status, return_json, error_json):
        self.writer.span_finish({
            "id": rec["span_id"], "trace_id": rec["trace_id"],
            "parent_id": rec["parent_id"], "function_id": rec["function_id"],
            "name": rec["name"], "started_at": rec["started_at"],
            "ended_at": time.time(), "status": status,
            "args_json": rec["args_json"], "return_json": return_json,
            "error_json": error_json, "seq": rec["seq"],
        })

    def _find_parent(self, frame):
        f = frame.f_back
        while f is not None:
            rec = self._frames.get(id(f))
            if rec is not None:
                return rec
            f = f.f_back
        return None

    def _identify(self, code, frame):
        """
        개요: code 객체에서 function_id('<상대경로>::<qualname>')를 만든다.
        참고: 3.11+는 co_qualname 사용, 이전 버전은 self/cls 타입명으로 근사한다.
        """
        cached = self._fid_cache.get(code)
        if cached is not None:
            return cached
        qualname = getattr(code, "co_qualname", None)
        if qualname is None:
            qualname = code.co_name
            slf = frame.f_locals.get("self")
            cls = frame.f_locals.get("cls")
            if slf is not None:
                qualname = type(slf).__name__ + "." + qualname
            elif isinstance(cls, type):
                qualname = cls.__name__ + "." + qualname
        try:
            path = str(Path(code.co_filename).resolve())
        except Exception:
            path = code.co_filename
        rel = path[len(self._root):] if path.startswith(self._root) else path
        result = (rel + "::" + qualname, qualname)
        # co_qualname이 없는 구버전은 frame마다 근사가 달라질 수 있어 캐시하지 않는다
        if hasattr(code, "co_qualname"):
            self._fid_cache[code] = result
        return result
