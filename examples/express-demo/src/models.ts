/**
 * 개요: 상품 하나의 재고 현황을 담는 엔티티.
 * 파라미터:
 *   - itemId: 상품 식별자
 *   - name: 상품 이름
 *   - quantity: 남은 재고 수량
 * 참고: 재고는 음수가 될 수 없다.
 */
export interface Stock {
  itemId: string
  name: string
  quantity: number
}

/**
 * 개요: 고객의 주문 정보를 담는 엔티티.
 * 파라미터:
 *   - orderId: 주문 번호
 *   - itemId: 주문한 상품 식별자
 *   - quantity: 주문 수량
 *   - status: 주문 상태 (created | cancelled)
 * 참고: 취소된 주문은 재고를 되돌려 놓는다.
 */
export interface Order {
  orderId: string
  itemId: string
  quantity: number
  status: string
}

/**
 * 개요: 주문 생성 결과 응답.
 * 파라미터:
 *   - order: 생성된 주문
 *   - remainingStock: 주문 후 남은 재고 수량
 */
export interface OrderResult {
  order: Order
  remainingStock: number
}
