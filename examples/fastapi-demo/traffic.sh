#!/bin/sh
# 개요: 데모 앱에 요청 몇 발을 보내 트레이스를 만든다. (앱이 8000 포트에 떠 있어야 함)
BASE="${1:-http://127.0.0.1:8000}"

curl -s "$BASE/inventory" > /dev/null
curl -s -X POST "$BASE/orders" -H 'Content-Type: application/json' \
  -d '{"item_id": "apple", "quantity": 3}'
echo
curl -s -X POST "$BASE/orders" -H 'Content-Type: application/json' \
  -d '{"item_id": "banana", "quantity": 999}'   # 재고 부족 → 409
echo
curl -s "$BASE/orders/no-such-order" > /dev/null   # 404
curl -s "$BASE/inventory" > /dev/null
echo "done"
