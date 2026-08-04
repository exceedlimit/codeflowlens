"""개요: 재고/주문 도메인의 엔티티 정의."""

from typing import Optional

from pydantic import BaseModel


class Stock(BaseModel):
    """
    개요: 상품 하나의 재고 현황을 담는 엔티티.
    파라미터:
      - item_id: 상품 식별자
      - name: 상품 이름
      - quantity: 남은 재고 수량
    참고: 재고는 음수가 될 수 없다.
    """

    item_id: str
    name: str
    quantity: int


class Order(BaseModel):
    """
    개요: 고객의 주문 정보를 담는 엔티티.
    파라미터:
      - order_id: 주문 번호
      - item_id: 주문한 상품 식별자
      - quantity: 주문 수량
      - status: 주문 상태 (created | cancelled)
    참고: 취소된 주문은 재고를 되돌려 놓는다.
    """

    order_id: str
    item_id: str
    quantity: int
    status: str = "created"


class OrderRequest(BaseModel):
    """
    개요: 주문 생성 요청 본문.
    파라미터:
      - item_id: 주문할 상품 식별자
      - quantity: 주문 수량
    """

    item_id: str
    quantity: int


class OrderResult(BaseModel):
    """
    개요: 주문 생성 결과 응답.
    파라미터:
      - order: 생성된 주문
      - remaining_stock: 주문 후 남은 재고 수량
    """

    order: Order
    remaining_stock: int
