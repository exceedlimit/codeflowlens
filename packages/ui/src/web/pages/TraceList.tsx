// 개요: 트레이스 목록 화면 — 기간 구간·진입점 멀티 선택·서비스 필터와 무한 스크롤.
// 로직: 스크롤이 바닥에 닿으면 다음 페이지를 이어 붙이고, 2초마다 첫 페이지를 다시 받아
//       새 트레이스를 위에 끼워 넣는다. 추적 제외된 진입점은 서버가 걸러서 보내지 않는다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchTraces, type TraceFilter, type TraceSummary } from "../api.js";
import StatusBadge from "../components/StatusBadge.js";

const PAGE_SIZE = 50;

function formatDateTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  const time = d.toLocaleTimeString("ko-KR", { hour12: false });
  return `${date} ${time}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const PRESETS: { value: string; label: string; seconds: number | null }[] = [
  { value: "all", label: "전체 기간", seconds: null },
  { value: "15m", label: "최근 15분", seconds: 15 * 60 },
  { value: "1h", label: "최근 1시간", seconds: 3600 },
  { value: "6h", label: "최근 6시간", seconds: 6 * 3600 },
  { value: "24h", label: "최근 24시간", seconds: 24 * 3600 },
  { value: "7d", label: "최근 7일", seconds: 7 * 86400 },
  { value: "custom", label: "직접 설정…", seconds: null },
];

const SERVICE_LABEL: Record<string, string> = { python: "Python", node: "Node" };

/** 개요: datetime-local 입력값을 epoch 초로 바꾼다(빈 값은 undefined). */
function toEpoch(value: string): number | undefined {
  if (!value) return undefined;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t / 1000 : undefined;
}

export default function TraceList() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<{ entries: string[]; services: string[] }>({
    entries: [], services: [],
  });
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [service, setService] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const entryBoxRef = useRef<HTMLDivElement | null>(null);

  /** 개요: 현재 필터를 API 파라미터로 만든다. 프리셋 기간은 호출 시점 기준으로 계산한다. */
  const buildFilter = useCallback((): TraceFilter => {
    let since: number | undefined;
    let until: number | undefined;
    if (preset === "custom") {
      since = toEpoch(customFrom);
      until = toEpoch(customTo);
    } else {
      const seconds = PRESETS.find((p) => p.value === preset)?.seconds ?? null;
      if (seconds) since = Date.now() / 1000 - seconds;
    }
    return { q, entries: selectedEntries, service, since, until, limit: PAGE_SIZE };
  }, [q, preset, customFrom, customTo, selectedEntries, service]);

  // --- 필터가 바뀌면 처음부터 다시 ------------------------------------
  useEffect(() => {
    let alive = true;
    fetchTraces(buildFilter())
      .then((r) => {
        if (!alive) return;
        setTraces(r.traces);
        setTotal(r.total);
        setFacets(r.facets);
        setError(null);
      })
      .catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [buildFilter]);

  // --- 2초마다 첫 페이지 갱신: 새 트레이스를 위에 끼워 넣는다 -----------
  useEffect(() => {
    const timer = setInterval(() => {
      fetchTraces(buildFilter())
        .then((r) => {
          setTotal(r.total);
          setFacets(r.facets);
          setTraces((existing) => {
            const firstIds = new Set(r.traces.map((t) => t.id));
            return [...r.traces, ...existing.filter((t) => !firstIds.has(t.id))];
          });
        })
        .catch(() => { /* 폴링 실패는 다음 주기에 */ });
    }, 2000);
    return () => clearInterval(timer);
  }, [buildFilter]);

  // --- 무한 스크롤: 바닥 근처에 오면 다음 페이지 ------------------------
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      setLoadingMore((already) => {
        if (already) return already;
        fetchTraces({ ...buildFilter(), offset: traces.length })
          .then((r) => {
            setTraces((existing) => {
              const ids = new Set(existing.map((t) => t.id));
              return [...existing, ...r.traces.filter((t) => !ids.has(t.id))];
            });
            setTotal(r.total);
          })
          .catch(() => { /* 다음 스크롤에서 재시도 */ })
          .finally(() => setLoadingMore(false));
        return true;
      });
    }, { rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [buildFilter, traces.length]);

  // --- 진입점 드롭다운 바깥 클릭 시 닫기 -------------------------------
  useEffect(() => {
    if (!entryOpen) return;
    const close = (e: MouseEvent) => {
      if (!entryBoxRef.current?.contains(e.target as Node)) setEntryOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [entryOpen]);

  const toggleEntry = (entry: string) => {
    setSelectedEntries((current) =>
      current.includes(entry)
        ? current.filter((e) => e !== entry)
        : [...current, entry],
    );
  };

  const hasMore = traces.length < total;
  const emptyNoFilter =
    total === 0 && !q && selectedEntries.length === 0 && !service && preset === "all";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>트레이스</h1>

        <select className="search" style={{ width: "auto" }} value={preset}
          onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {preset === "custom" && (
          <>
            <input type="datetime-local" className="search" style={{ width: "auto" }}
              value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="meta">~</span>
            <input type="datetime-local" className="search" style={{ width: "auto" }}
              value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}

        {/* 진입점 멀티 선택 */}
        <div ref={entryBoxRef} style={{ position: "relative" }}>
          <button className="search" style={{ width: "auto", cursor: "pointer" }}
            onClick={() => setEntryOpen(!entryOpen)}>
            진입점 {selectedEntries.length > 0 ? `(${selectedEntries.length}개 선택)` : "전체"} ▾
          </button>
          {entryOpen && (
            <div className="entry-dropdown">
              {selectedEntries.length > 0 && (
                <button className="list-tool" style={{ margin: "4px 8px" }}
                  onClick={() => setSelectedEntries([])}>
                  선택 해제
                </button>
              )}
              {facets.entries.length === 0 && (
                <div className="panel-section"><span className="placeholder">진입점 없음</span></div>
              )}
              {facets.entries.map((entry) => (
                <label key={entry} className="entry-option">
                  <input
                    type="checkbox"
                    checked={selectedEntries.includes(entry)}
                    onChange={() => toggleEntry(entry)}
                  />
                  <span>{entry}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <select className="search" style={{ width: "auto" }} value={service}
          onChange={(e) => setService(e.target.value)}>
          <option value="">모든 서비스</option>
          {facets.services.map((s) => (
            <option key={s} value={s}>{SERVICE_LABEL[s] ?? s}</option>
          ))}
        </select>
        <input
          className="search"
          placeholder="진입점 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="meta">
          조건에 맞는 {total}건 · 불러온 {traces.length}건
        </span>
        {error && <span className="meta">{error}</span>}
      </div>

      {traces.length === 0 && (
        <div className="empty">
          {emptyNoFilter ? (
            <>아직 기록이 없어요 — <code>flowlens run &lt;명령&gt;</code>으로 앱을 실행하면
            트레이스가 여기 나타납니다.</>
          ) : (
            <>조건에 맞는 트레이스가 없어요 — 필터를 조정해보세요.</>
          )}
        </div>
      )}

      {traces.length > 0 && (
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
                <td className="meta" style={{ whiteSpace: "nowrap" }}>
                  {formatDateTime(t.started_at)}
                </td>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                  {t.entry_name}
                  {t.http_status != null && (
                    <span className="meta"> · {t.http_status}</span>
                  )}
                </td>
                <td className="meta">
                  {t.entry_kind === "http" ? "요청" : t.entry_kind === "event" ? "이벤트" : "프로세스"}
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

      {/* 무한 스크롤 감지선 */}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {hasMore && (
        <div className="meta" style={{ textAlign: "center", padding: 12 }}>
          {loadingMore ? "더 불러오는 중…" : "스크롤하면 더 불러옵니다"}
        </div>
      )}
    </div>
  );
}
