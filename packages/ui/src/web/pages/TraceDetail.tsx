// 개요: 트레이스 상세 화면 — 호출 트리(왼쪽) + 선택 스팬 상세(오른쪽).
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchTrace, type SpanRow, type TraceSummary } from "../api.js";
import SpanPanel from "../components/SpanPanel.js";
import SpanTree from "../components/SpanTree.js";
import StatusBadge from "../components/StatusBadge.js";
import { buildTree } from "../lib/tree.js";

interface ClientEvent {
  page_url: string;
  method: string | null;
  url: string | null;
  duration_ms: number | null;
}

function pagePath(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

export default function TraceDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    trace: TraceSummary; spans: SpanRow[]; client_event?: ClientEvent | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SpanRow | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchTrace(id).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  const roots = useMemo(() => (data ? buildTree(data.spans) : []), [data]);

  if (error) return <div className="empty">{error} — <Link to="/">목록으로</Link></div>;
  if (!data) return <div className="meta">불러오는 중…</div>;

  const { trace } = data;
  const traceDuration =
    trace.ended_at != null ? trace.ended_at - trace.started_at : 0;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/">← 목록</Link>
      </div>
      <div className="detail-layout">
        <div className="card">
          <div className="card-head">
            <h2 style={{ fontFamily: "ui-monospace, monospace" }}>{trace.entry_name}</h2>
            <StatusBadge status={trace.status} />
            <span className="meta">
              {new Date(trace.started_at * 1000).toLocaleString("ko-KR")} ·{" "}
              {trace.duration_ms != null ? `${trace.duration_ms.toFixed(1)}ms` : "진행중"} ·{" "}
              호출 {data.spans.length}건
            </span>
            {data.client_event && (
              <span className="meta" title={data.client_event.page_url}>
                🌐 화면 {pagePath(data.client_event.page_url)} 에서 발생
                {data.client_event.duration_ms != null &&
                  ` · 브라우저 왕복 ${data.client_event.duration_ms.toFixed(0)}ms`}
              </span>
            )}
          </div>
          <div className="card-body">
            {data.spans.length === 0 ? (
              <div className="empty">이 트레이스에 기록된 함수 호출이 없습니다.</div>
            ) : (
              <SpanTree
                roots={roots}
                traceStart={trace.started_at}
                traceDuration={traceDuration}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>
        <div className="card" style={{ alignSelf: "start", position: "sticky", top: 60 }}>
          <SpanPanel span={selected} />
        </div>
      </div>
    </div>
  );
}
