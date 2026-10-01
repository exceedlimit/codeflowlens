import React, { useState } from "react";

/**
 * 개요: 재고/주문 데모 화면 — 버튼 클릭이 백엔드 흐름으로 이어지는 것을 보여준다.
 * 로직: 각 버튼이 백엔드 API를 호출하고 응답을 그대로 표시한다.
 */
export default function App() {
  const [result, setResult] = useState("버튼을 눌러보세요.");

  /**
   * 개요: API를 호출하고 결과를 화면에 보여준다.
   * 로직: 응답 JSON을 문자열로 만들어 상태에 저장한다.
   */
  async function call(path: string, init?: RequestInit) {
    try {
      const res = await fetch(path, init);
      const body = await res.json();
      setResult(`${res.status} ← ${path}\n` + JSON.stringify(body, null, 2));
    } catch (e) {
      setResult(String(e));
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "40px auto" }}>
      <h1>CodeFlowLens 데모 상점</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => call("/inventory")}>재고 조회</button>
        <button
          onClick={() =>
            call("/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId: "apple", quantity: 2 }),
            })
          }
        >
          사과 2개 주문
        </button>
        <button
          onClick={() =>
            call("/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId: "banana", quantity: 999 }),
            })
          }
        >
          바나나 999개 주문 (재고 부족)
        </button>
      </div>
      <pre style={{ background: "#f1f5f9", padding: 16, marginTop: 16 }}>{result}</pre>
    </main>
  );
}
