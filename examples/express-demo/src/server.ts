import express from "express"

import { listStocks } from "./repo.ts"
import { OutOfStockError, createOrder, getOrderDetail } from "./service.ts"

const app = express()
app.use(express.json())

/**
 * 개요: 전체 재고 목록을 돌려준다.
 * 로직: 저장소의 재고를 그대로 응답한다.
 */
function inventoryHandler(req: express.Request, res: express.Response): void {
  res.json(listStocks())
}

/**
 * 개요: 주문을 생성한다.
 * 로직: 서비스 계층에 주문 생성을 맡기고, 재고 부족이면 409로 응답한다.
 */
function createOrderHandler(req: express.Request, res: express.Response): void {
  try {
    res.json(createOrder(req.body.itemId, req.body.quantity))
  } catch (e) {
    if (e instanceof OutOfStockError) res.status(409).json({ detail: e.message })
    else res.status(500).json({ detail: String(e) })
  }
}

/**
 * 개요: 주문 상세를 돌려준다.
 * 로직: 서비스 계층에서 주문을 찾고, 없으면 404로 응답한다.
 */
function orderDetailHandler(req: express.Request, res: express.Response): void {
  try {
    res.json(getOrderDetail(req.params.orderId))
  } catch {
    res.status(404).json({ detail: `없는 주문: ${req.params.orderId}` })
  }
}

app.get("/inventory", inventoryHandler)
app.post("/orders", createOrderHandler)
app.get("/orders/:orderId", orderDetailHandler)

const port = Number(process.env.PORT ?? 8300)
app.listen(port, () => console.log(`express-demo listening on ${port}`))
