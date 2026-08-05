// 개요: 상단 바의 코드맵 갱신 표시 — 마지막 갱신 시각과 "지금 갱신" 버튼.
import React, { useState } from "react";

import { useScanStatus } from "../lib/scanStatus.js";

function agoText(epochSec: number | null): string {
  if (epochSec == null) return "갱신 기록 없음";
  const sec = Math.max(0, Date.now() / 1000 - epochSec);
  if (sec < 10) return "방금 갱신됨";
  if (sec < 60) return `${Math.floor(sec)}초 전 갱신`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전 갱신`;
  return `${Math.floor(sec / 3600)}시간 전 갱신`;
}

export default function ScanStatusBar() {
  const { scanning, lastScanAt, watching, lastResult, scanNow } = useScanStatus();
  const [message, setMessage] = useState<string | null>(null);

  const onClick = async () => {
    setMessage(null);
    const result = await scanNow();
    setMessage(result || "갱신 완료");
  };

  const failed = lastResult && !lastResult.ok;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        className="meta"
        title={
          watching
            ? "소스 파일을 저장하면 코드맵(주석·관계도·엔티티)이 자동으로 갱신됩니다."
            : "자동 감지가 꺼져 있습니다 — 버튼으로 갱신하세요."
        }
      >
        코드맵 {watching && "자동 "}
        {scanning ? "갱신 중…" : agoText(lastScanAt)}
      </span>
      <button
        className="search"
        style={{ width: "auto", cursor: scanning ? "default" : "pointer", padding: "4px 10px" }}
        onClick={onClick}
        disabled={scanning}
      >
        지금 갱신
      </button>
      {(message || failed) && (
        <span className="meta" style={failed ? { color: "var(--err-fg)" } : undefined}>
          {message ?? lastResult?.message}
        </span>
      )}
    </span>
  );
}
