"""
개요: FastAPI/Starlette 앱의 요청 1건을 트레이스 1건으로 묶는 패치.
로직: Starlette.__call__(모든 FastAPI 요청이 지나는 지점)을 감싸, 요청 시작 시
      요청 트레이스를 열고 응답 상태코드를 관찰한 뒤 닫는다.
참고: 코드 수정 0 원칙의 웹 프레임워크 버전 — 사용자 앱 코드는 건드리지 않는다.
      starlette이 없으면 조용히 아무것도 하지 않는다(fail-open).
"""

_patched = False


def patch_starlette(session):
    """
    개요: Starlette/FastAPI에 요청 그룹핑을 설치한다. 해제 함수를 돌려준다.
    참고: bootstrap이 앱 import보다 먼저 실행되므로 여기서 starlette을 직접 import한다
          (설치 안 된 프로젝트면 ImportError → 호출부에서 무시).
    """
    global _patched
    from starlette.applications import Starlette

    if _patched:
        return lambda: None
    original = Starlette.__call__

    async def traced_call(self, scope, receive, send):
        """개요: http 요청이면 트레이스로 감싸고, 아니면(웹소켓 등) 그대로 통과시킨다."""
        if scope.get("type") != "http":
            return await original(self, scope, receive, send)
        try:
            method = scope.get("method", "GET")
            path = scope.get("path", "/")
            entry_name = f"{method} {path}"

            # 설정에서 "추적 안 함"으로 지정한 진입점은 트레이스도 스팬도 남기지 않는다
            exclusions = getattr(session, "exclusions", None)
            if exclusions is not None and exclusions.is_excluded(entry_name):
                discard_token = session.begin_discard()
                try:
                    return await original(self, scope, receive, send)
                finally:
                    session.end_discard(discard_token)

            client_trace_id = None
            for key, value in scope.get("headers", []):
                if key == b"x-codeflowlens-trace":
                    client_trace_id = value.decode("utf-8", "ignore")
                    break
            token, trace_id = session.begin_request_trace(
                entry_name, method, path, client_trace_id
            )
        except Exception:
            return await original(self, scope, receive, send)

        status_holder = {}

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                status_holder["status"] = message.get("status")
            await send(message)

        try:
            result = await original(self, scope, receive, send_wrapper)
        except BaseException:
            session.end_request_trace(
                token, trace_id, "error", status_holder.get("status")
            )
            raise
        http_status = status_holder.get("status")
        status = "error" if (http_status or 500) >= 500 else "ok"
        session.end_request_trace(token, trace_id, status, http_status)
        return result

    Starlette.__call__ = traced_call
    _patched = True

    def unpatch():
        global _patched
        Starlette.__call__ = original
        _patched = False

    return unpatch
