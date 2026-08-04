"""개요: 재고/주문 데이터를 메모리에 보관하는 저장소 계층."""

import uuid
from typing import Optional

from app.models import Order, Stock

_stocks = {
    "apple": Stock(item_id="apple", name="사과", quantity=10),
    "banana": Stock(item_id="banana", name="바나나", quantity=5),
}
_orders = {}


def get_stock(item_id: str) -> Optional[Stock]:
    """
    개요: 상품의 재고 현황을 조회한다.
    로직: 메모리 저장소에서 상품 식별자로 찾아 돌려준다. 없으면 None.
    """
    return _stocks.get(item_id)


def list_stocks() -> list:
    """
    개요: 전체 상품의 재고 목록을 조회한다.
    로직: 메모리 저장소의 모든 재고를 리스트로 돌려준다.
    """
    return list(_stocks.values())


def save_stock(stock: Stock) -> Stock:
    """
    개요: 재고 현황을 저장한다.
    로직: 상품 식별자를 키로 메모리 저장소에 덮어쓴다.
    """
    _stocks[stock.item_id] = stock
    return stock


def save_order(order: Order) -> Order:
    """
    개요: 주문을 저장한다.
    로직: 주문 번호를 키로 메모리 저장소에 덮어쓴다.
    """
    _orders[order.order_id] = order
    return order


def get_order(order_id: str) -> Optional[Order]:
    """
    개요: 주문을 조회한다.
    로직: 주문 번호로 메모리 저장소에서 찾아 돌려준다. 없으면 None.
    """
    return _orders.get(order_id)


def new_order_id() -> str:
    """
    개요: 새 주문 번호를 발급한다.
    로직: 짧은 uuid를 만들어 'ord-' 접두어를 붙인다.
    """
    return "ord-" + uuid.uuid4().hex[:8]
