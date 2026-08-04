"""개요: ASGI 요청 그룹핑 테스트용 Starlette 앱."""

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route


def compute(n):
    """개요: 주문 수량을 두 배로 계산한다."""
    return n * 2


async def orders(request):
    """개요: 주문 목록을 돌려준다."""
    return JSONResponse({"result": compute(3)})


async def fail(request):
    """개요: 일부러 서버 오류를 낸다."""
    raise RuntimeError("boom")


app = Starlette(routes=[Route("/orders", orders), Route("/fail", fail)])
