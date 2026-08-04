import { randomUUID } from "node:crypto"

import type { Order, Stock } from "./models.ts"

const stocks = new Map<string, Stock>([
  ["apple", { itemId: "apple", name: "사과", quantity: 10 }],
  ["banana", { itemId: "banana", name: "바나나", quantity: 5 }],
])
const orders = new Map<string, Order>()

/**
 * 개요: 상품의 재고 현황을 조회한다.
 * 로직: 메모리 저장소에서 상품 식별자로 찾아 돌려준다. 없으면 undefined.
 */
export function getStock(itemId: string): Stock | undefined {
  return stocks.get(itemId)
}

/**
 * 개요: 전체 상품의 재고 목록을 조회한다.
 * 로직: 메모리 저장소의 모든 재고를 배열로 돌려준다.
 */
export function listStocks(): Stock[] {
  return [...stocks.values()]
}

/**
 * 개요: 재고 현황을 저장한다.
 * 로직: 상품 식별자를 키로 메모리 저장소에 덮어쓴다.
 */
export function saveStock(stock: Stock): Stock {
  stocks.set(stock.itemId, stock)
  return stock
}

/**
 * 개요: 주문을 저장한다.
 * 로직: 주문 번호를 키로 메모리 저장소에 덮어쓴다.
 */
export function saveOrder(order: Order): Order {
  orders.set(order.orderId, order)
  return order
}

/**
 * 개요: 주문을 조회한다.
 * 로직: 주문 번호로 메모리 저장소에서 찾아 돌려준다.
 */
export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId)
}

/**
 * 개요: 새 주문 번호를 발급한다.
 * 로직: 짧은 uuid를 만들어 'ord-' 접두어를 붙인다.
 */
export function newOrderId(): string {
  return "ord-" + randomUUID().slice(0, 8)
}
