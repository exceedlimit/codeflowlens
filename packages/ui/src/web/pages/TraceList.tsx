// 개요: 트레이스 목록 화면 — 기간/진입점/서비스 필터와 함께 최근 실행/요청을 보여준다.
// 로직: 2초마다 갱신. 필터는 서버에서 적용되고, 조건에 맞는 전체 건수(total)를 함께 표시한다.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchTraces, type TraceListResult, type TraceSummary } from "../api.js";
import StatusBadge from "../components/StatusBadge.js";

function formatTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("ko-KR", { hour12: false });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const PERIODS: { value: string; label: string; seconds: number | null }[] = [
  { value: "all", label: "전체 기간", seconds: null },
  { value: "1h", label: "최근 1시간", seconds: 3600 },
  { value: "6h", label: "최근 6시간", seconds: 6 * 3600 },
  { value: "24h", label: "최근 24시간", seconds: 24 * 3600 },
  { value: "7d", label: "최근 7일", seconds: 7 * 86400 },
];

const SERVICE_LABEL: Record<string, string> = { python: "Python", node: "Node" };

export default function TraceList() {
  const [result, setResult] = useState<TraceListResult | null>(null);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("all");
  const [entry, setEntry] = useState("");
  const [service, setService] = useState("");
  const [limit, setLimit] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => {
      const seconds = PERIODS.find((p) => p.value === period)?.seconds ?? null;
      fetchTraces({
        q,
        entry,
        service,
        limit,
        since: seconds ? Date.now() / 1000 - seconds : undefined,
      })
        .then((r) => alive && (setResult(r), setError(null)))
        .catch((e) => alive && setError(String(e)));
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [q, period, entry, service, limit]);

  const traces = result?.traces ?? null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>트레이스</h1>
        <select className="search" style={{ width: "auto" }} value={period}
          onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select className="search" style={{ width: "auto", maxWidth: 220 }} value={entry}
          onChange={(e) => setEntry(e.target.value)}>
          <option value="">모든 진입점</option>
          {(result?.facets.entries ?? []).map((en) => (
            <option key={en} value={en}>{en}</option>
          ))}
        </select>
        <select className="search" style={{ width: "auto" }} value={service}
          onChange={(e) => setService(e.target.value)}>
          <option value="">모든 서비스</option>
          {(result?.facets.services ?? []).map((s) => (
            <option key={s} value={s}>{SERVICE_LABEL[s] ?? s}</option>
          ))}
        </select>
        <select className="search" style={{ width: "auto" }} value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}>
          {[100, 300, 1000].map((n) => <option key={n} value={n}>{n}개씩</option>)}
        </select>
        <input
          className="search"
          placeholder="진입점 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {result && (
          <span className="meta">
            조건에 맞는 {result.total}건
            {result.total > (traces?.length ?? 0) && ` 중 최신 ${traces?.length}건 표시`}
          </span>
        )}
        {error && <span className="meta">{error}</span>}
      </div>

      {traces && traces.length === 0 && (
        <div className="empty">
          {result && result.total === 0 && !q && !entry && !service && period === "all" ? (
            <>아직 기록이 없어요 — <code>flowlens run &lt;명령&gt;</code>으로 앱을 실행하면
            트레이스가 여기 나타납니다.</>
          ) : (
            <>조건에 맞는 트레이스가 없어요 — 필터를 조정해보세요.</>
          )}
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
                <td className="meta">
                  {t.entry_kind === "http" ? "요청" : "프로세스"}
                  {t.service && ` · ${SERVICE_LABEL[t.service] ?? t.service}`}
                  {t.client_trace_id && <span title="화면(브라우저)에서 시작된 요청"> 🌐</span>}
                </td>
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
