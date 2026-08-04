"""개요: 주문 처리 비즈니스 로직 계층."""

from app import repo
from app.models import Order, OrderRequest, OrderResult, Stock


class OutOfStockError(Exception):
    """개요: 재고가 부족할 때 발생하는 오류."""


def create_order(request: OrderRequest) -> OrderResult:
    """
    개요: 주문을 생성하고 재고를 차감한다.
    로직: 재고를 확인해 부족하면 오류를 내고, 충분하면 주문 저장과 재고 차감을 함께 수행한다.
    참고: 재고보다 많은 수량은 주문할 수 없다.
    """
    stock = repo.get_stock(request.item_id)
    if stock is None:
        raise OutOfStockError(f"없는 상품: {request.item_id}")
    if stock.quantity < request.quantity:
        raise OutOfStockError(
            f"재고 부족: {stock.name} 남은 수량 {stock.quantity} < 주문 {request.quantity}"
        )
    order = Order(
        order_id=repo.new_order_id(),
        item_id=request.item_id,
        quantity=request.quantity,
    )
    repo.save_order(order)
    remaining = deduct_stock(stock, request.quantity)
    return OrderResult(order=order, remaining_stock=remaining.quantity)


def deduct_stock(stock: Stock, quantity: int) -> Stock:
    """
    개요: 재고 수량을 차감한다.
    로직: 현재 재고에서 주문 수량을 빼서 저장한다.
    참고: 호출 전에 재고 충분 여부가 검증되어 있어야 한다.
    """
    updated = stock.model_copy(update={"quantity": stock.quantity - quantity})
    return repo.save_stock(updated)


def get_order_detail(order_id: str) -> Order:
    """
    개요: 주문 상세를 조회한다.
    로직: 저장소에서 주문을 찾아 돌려주고, 없으면 KeyError를 낸다.
    """
    order = repo.get_order(order_id)
    if order is None:
        raise KeyError(order_id)
    return order
