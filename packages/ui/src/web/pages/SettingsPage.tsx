// 개요: 설정 화면 — 데이터 보존 주기(기본 7일)와 값 크기 상한을 관리한다.
import React, { useEffect, useState } from "react";

export default function SettingsPage() {
  const [retentionDays, setRetentionDays] = useState<number>(7);
  const [maxKb, setMaxKb] = useState<number>(64);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setRetentionDays(s.retention_days);
        setMaxKb(Math.round(s.value_max_bytes / 1024));
      })
      .catch(() => setMessage("설정을 불러오지 못했습니다."));
  }, []);

  async function save() {
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retention_days: retentionDays,
        value_max_bytes: maxKb * 1024,
      }),
    });
    if (res.ok) setMessage("저장했습니다. 정리는 매일 자동으로 실행됩니다.");
    else setMessage(`저장 실패: ${(await res.json()).error ?? res.status}`);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>설정</h1>
      <div className="card">
        <div className="panel-section">
          <h3>데이터 보존 주기</h3>
          <p className="doc-line">
            <input
              className="search" type="number" min={1} style={{ width: 90 }}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            />{" "}
            일 (기본 7일)
          </p>
          <p className="meta">
            주기가 지난 <b>실행 기록</b>(트레이스/호출/브라우저 이벤트)만 자동 삭제됩니다.
            코드맵(함수·주석·관계도·엔티티)은 시간과 무관하므로 유지됩니다.
          </p>
        </div>
        <div className="panel-section">
          <h3>파라미터/리턴값 크기 상한</h3>
          <p className="doc-line">
            <input
              className="search" type="number" min={1} style={{ width: 90 }}
              value={maxKb}
              onChange={(e) => setMaxKb(Number(e.target.value))}
            />{" "}
            KB (값 1개 기준, 기본 64KB)
          </p>
          <p className="meta">
            상한을 넘는 값은 잘려서 저장됩니다. 다음 <code>flowlens run</code>부터 적용됩니다.
          </p>
        </div>
        <div className="panel-section">
          <button
            onClick={save}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--accent)", color: "white", cursor: "pointer",
              fontWeight: 600,
            }}
          >
            저장
          </button>
          {message && <span className="meta" style={{ marginLeft: 10 }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}
