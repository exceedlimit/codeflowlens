import type { Order, OrderResult, Stock } from "./models.ts"
import { getOrder, getStock, newOrderId, saveOrder, saveStock } from "./repo.ts"

/** 개요: 재고가 부족할 때 발생하는 오류. */
export class OutOfStockError extends Error {}

/**
 * 개요: 주문을 생성하고 재고를 차감한다.
 * 로직: 재고를 확인해 부족하면 오류를 내고, 충분하면 주문 저장과 재고 차감을 함께 수행한다.
 * 참고: 재고보다 많은 수량은 주문할 수 없다.
 */
export function createOrder(itemId: string, quantity: number): OrderResult {
  const stock = getStock(itemId)
  if (!stock) throw new OutOfStockError(`없는 상품: ${itemId}`)
  if (stock.quantity < quantity) {
    throw new OutOfStockError(
      `재고 부족: ${stock.name} 남은 수량 ${stock.quantity} < 주문 ${quantity}`,
    )
  }
  const order: Order = {
    orderId: newOrderId(), itemId, quantity, status: "created",
  }
  saveOrder(order)
  const remaining = deductStock(stock, quantity)
  return { order, remainingStock: remaining.quantity }
}

/**
 * 개요: 재고 수량을 차감한다.
 * 로직: 현재 재고에서 주문 수량을 빼서 저장한다.
 * 참고: 호출 전에 재고 충분 여부가 검증되어 있어야 한다.
 */
export function deductStock(stock: Stock, quantity: number): Stock {
  return saveStock({ ...stock, quantity: stock.quantity - quantity })
}

/**
 * 개요: 주문 상세를 조회한다.
 * 로직: 저장소에서 주문을 찾아 돌려주고, 없으면 오류를 낸다.
 */
export function getOrderDetail(orderId: string): Order {
  const order = getOrder(orderId)
  if (!order) throw new Error(`없는 주문: ${orderId}`)
  return order
}
