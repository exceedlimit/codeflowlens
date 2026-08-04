// 개요: 트레이스/스팬 상태 배지 — 색만으로 구분하지 않도록 아이콘+라벨을 함께 쓴다.
import React from "react";

const LABEL: Record<string, { icon: string; text: string }> = {
  ok: { icon: "✓", text: "성공" },
  error: { icon: "✕", text: "에러" },
  running: { icon: "●", text: "실행중" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = LABEL[status] ?? { icon: "?", text: status };
  return (
    <span className={`badge ${status}`}>
      <span aria-hidden>{s.icon}</span>
      {s.text}
    </span>
  );
}
