# CodeFlowLens 주석 룰 (필수)

이 프로젝트는 CodeFlowLens로 모니터링됩니다. **코드를 작성/수정할 때 아래 룰을 반드시 지키세요.**
UI가 이 주석을 파싱해 사람에게 보여주므로 형식이 어긋나면 표시되지 않습니다. `codeflowlens check`로 언제든 검증할 수 있습니다.

## 원칙

- 주석은 **비즈니스 관점**으로 쓴다. 코드 구조·문법 설명 금지.
  - BAD: `plus_count를 호출합니다.`
  - GOOD: `재고 수량을 추가합니다.`
- 새 함수/클래스를 만들면 **즉시** 주석을 쓴다. 로직을 바꾸면 주석도 **같이** 고친다.
- 라벨은 한국어(`개요/로직/참고/파라미터`)를 기본으로 쓴다. (영문 별칭 Overview/Logic/Note/Fields 허용)

## 함수/메서드 — `개요`(필수) · `로직`(필수) · `참고`(선택)

```python
def add_stock(item_id: str, qty: int) -> Stock:
    """
    개요: 재고 수량을 추가한다.
    로직: 현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다.
    참고: 재고는 음수가 될 수 없다.
    """
```

```typescript
/**
 * 개요: 재고 수량을 추가한다.
 * 로직: 현재 재고를 조회한 뒤, 입력 수량을 더해 저장한다.
 * 참고: 재고는 음수가 될 수 없다.
 */
function addStock(itemId: string, qty: number): Stock {
```

완화 룰: `_`로 시작하는 내부 헬퍼, 테스트 함수, `__init__` 같은 던더는 `개요`만 있으면 됩니다.

## 클래스(엔티티) — `개요`(필수) · `파라미터`(필드 설명, 필수) · `참고`(선택)

```python
class Order(BaseModel):
    """
    개요: 고객의 주문 정보를 담는 엔티티.
    파라미터:
      - order_id: 주문 번호
      - quantity: 주문 수량
    참고: 취소된 주문은 quantity가 0이 된다.
    """
    order_id: str
    quantity: int
```

## 검증

```bash
codeflowlens check          # 위반 목록 출력 (위반 시 종료코드 1)
codeflowlens check --json   # 에이전트/스크립트 소비용
codeflowlens scan           # 코드맵(UI 표시용) 갱신
```

작업을 마치기 전에 `codeflowlens check`가 통과하는지 확인하세요.
기존 코드에 주석을 소급하는 방법은 `.codeflowlens/RETROFIT.md`를 따르세요.
