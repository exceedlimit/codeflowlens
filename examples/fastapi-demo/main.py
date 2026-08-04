"""개요: FlowLens 데모용 재고/주문 FastAPI 앱."""

from fastapi import FastAPI, HTTPException

from app import repo, service
from app.models import OrderRequest, OrderResult

app = FastAPI(title="FlowLens 데모 — 재고/주문")


@app.get("/inventory")
def inventory():
    """
    개요: 전체 재고 목록을 돌려준다.
    로직: 저장소의 재고를 그대로 응답한다.
    """
    return repo.list_stocks()


@app.post("/orders", response_model=OrderResult)
def create_order(request: OrderRequest):
    """
    개요: 주문을 생성한다.
    로직: 서비스 계층에 주문 생성을 맡기고, 재고 부족이면 409로 응답한다.
    """
    try:
        return service.create_order(request)
    except service.OutOfStockError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/orders/{order_id}")
def order_detail(order_id: str):
    """
    개요: 주문 상세를 돌려준다.
    로직: 서비스 계층에서 주문을 찾고, 없으면 404로 응답한다.
    """
    try:
        return service.get_order_detail(order_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"없는 주문: {order_id}")
