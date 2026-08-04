// 개요: 트레이스 목록 화면 — 최근 실행/요청을 2초마다 갱신해 보여준다.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchTraces, type TraceSummary } from "../api.js";
import StatusBadge from "../components/StatusBadge.js";

function formatTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("ko-KR", { hour12: false });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function TraceList() {
  const [traces, setTraces] = useState<TraceSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchTraces(q)
        .then((t) => alive && (setTraces(t), setError(null)))
        .catch((e) => alive && setError(String(e)));
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [q]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>트레이스</h1>
        <input
          className="search"
          placeholder="진입점 검색 (예: /orders)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {error && <span className="meta">{error}</span>}
      </div>

      {traces && traces.length === 0 && (
        <div className="empty">
          아직 기록이 없어요 — <code>flowlens run &lt;명령&gt;</code>으로 앱을 실행하면
          트레이스가 여기 나타납니다.
        </div>
      )}

      {traces && traces.length > 0 && (
        <table className="traces">
          <thead>
            <tr>
              <th>시각</th>
              <th>진입점</th>
              <th>종류</th>
              <th className="num">소요시간</th>
              <th className="num">호출 수</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={t.id} onClick={() => navigate(`/traces/${t.id}`)}>
                <td className="meta">{formatTime(t.started_at)}</td>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                  {t.entry_name}
                  {t.http_status != null && (
                    <span className="meta"> · {t.http_status}</span>
                  )}
                </td>
                <td className="meta">{t.entry_kind === "http" ? "요청" : "프로세스"}</td>
                <td className="num">{formatDuration(t.duration_ms)}</td>
                <td className="num">{t.span_count}</td>
                <td><StatusBadge status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
