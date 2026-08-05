// 개요: 메서드 관계도 화면 — 정적 호출 그래프 위에 실행 빈도를 겹쳐 보여준다.
// 로직: /api/graph의 노드를 호출 깊이로 배치하고, runtime 엣지는 호출 횟수만큼 굵게,
//       실행된 적 없는 함수는 흐리게 그린다. 노드 클릭 → 주석/관련 트레이스 패널.
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { computeDepths } from "../lib/layout.js";
import { useScanStatus } from "../lib/scanStatus.js";

interface GraphNode {
  id: string;
  name: string;
  file_path: string;
  line: number | null;
  doc_overview: string | null;
  doc_logic: string | null;
  doc_note: string | null;
  runtime_hits: number;
}
interface GraphEdge {
  source: string;
  target: string;
  kind: "static" | "runtime";
  count: number;
}
interface FnDetail {
  function: GraphNode & { qualified_name: string };
  traces: { id: string; entry_name: string; started_at: number; status: string }[];
}

export default function GraphPage() {
  const [params] = useSearchParams();
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [detail, setDetail] = useState<FnDetail | null>(null);

  const { lastScanAt } = useScanStatus(); // 코드맵이 갱신되면 다시 불러온다

  useEffect(() => {
    const url = q ? `/api/graph?q=${encodeURIComponent(q)}` : "/api/graph";
    fetch(url).then((r) => r.json()).then(setData).catch(() => setData(null));
  }, [q, lastScanAt]);

  const flow = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const depths = computeDepths(
      data.nodes.map((n) => n.id),
      data.edges,
    );
    // 같은 깊이 안에서는 파일별로 모아 세로 배치
    const byDepth = new Map<number, GraphNode[]>();
    for (const n of data.nodes) {
      const d = depths.get(n.id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    }
    const nodes: Node[] = [];
    for (const [d, group] of byDepth) {
      group.sort((a, b) => a.file_path.localeCompare(b.file_path) || (a.line ?? 0) - (b.line ?? 0));
      group.forEach((n, i) => {
        nodes.push({
          id: n.id,
          position: { x: d * 280, y: i * 72 },
          data: { label: n.name },
          style: {
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            opacity: n.runtime_hits > 0 ? 1 : 0.45,
          },
          sourcePosition: "right" as const,
          targetPosition: "left" as const,
        });
      });
    }
    const runtimePairs = new Set(
      data.edges.filter((e) => e.kind === "runtime").map((e) => e.source + "→" + e.target),
    );
    const edges: Edge[] = data.edges
      // 같은 호출 쌍에 static과 runtime이 둘 다 있으면 runtime만 그린다
      .filter((e) => e.kind === "runtime" || !runtimePairs.has(e.source + "→" + e.target))
      .map((e) => ({
        id: `${e.kind}:${e.source}→${e.target}`,
        source: e.source,
        target: e.target,
        animated: false,
        style:
          e.kind === "runtime"
            ? { stroke: "var(--accent)", strokeWidth: Math.min(1.5 + Math.log2(e.count + 1), 6) }
            : { stroke: "var(--text-muted)", strokeDasharray: "4 3", strokeWidth: 1, opacity: 0.6 },
      }));
    return { nodes, edges };
  }, [data]);

  const selectNode = (id: string) => {
    fetch(`/api/functions?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>메서드 관계도</h1>
        <input
          className="search"
          placeholder="함수/파일 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="meta">
          실선(파랑)=실제 실행된 호출(굵기=빈도) · 점선=코드상 호출 관계 · 흐린 노드=실행 기록 없음
        </span>
        {data?.truncated && <span className="meta">⚠ 300개 초과 — 검색으로 좁혀보세요</span>}
      </div>
      <div className="detail-layout">
        <div className="card" style={{ height: "70vh" }}>
          {data && data.nodes.length === 0 ? (
            <div className="empty" style={{ margin: 16 }}>
              코드맵이 비어 있어요 — <code>flowlens scan</code>을 실행하세요.
            </div>
          ) : (
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              onNodeClick={(_, node) => selectNode(node.id)}
              fitView
              minZoom={0.1}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          {!detail ? (
            <div className="panel-section">
              <span className="placeholder">노드를 클릭하면 설명이 표시됩니다.</span>
            </div>
          ) : (
            <div>
              <div className="panel-section">
                <h3>함수</h3>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                  {detail.function.qualified_name}
                </div>
                <div className="meta">
                  {detail.function.file_path}
                  {detail.function.line != null && `:${detail.function.line}`}
                </div>
              </div>
              <div className="panel-section">
                <h3>설명</h3>
                {detail.function.doc_overview ? (
                  <>
                    <p className="doc-line"><b>개요</b>{detail.function.doc_overview}</p>
                    {detail.function.doc_logic && (
                      <p className="doc-line"><b>로직</b>{detail.function.doc_logic}</p>
                    )}
                    {detail.function.doc_note && (
                      <p className="doc-line"><b>참고</b>{detail.function.doc_note}</p>
                    )}
                  </>
                ) : (
                  <span className="placeholder">주석 없음 — retrofit 작업이 필요합니다.</span>
                )}
              </div>
              <div className="panel-section">
                <h3>최근 실행</h3>
                {detail.traces.length === 0 ? (
                  <span className="placeholder">실행 기록 없음</span>
                ) : (
                  detail.traces.map((t) => (
                    <p className="doc-line" key={t.id}>
                      <Link to={`/traces/${t.id}`}>
                        {t.entry_name} · {new Date(t.started_at * 1000).toLocaleTimeString("ko-KR", { hour12: false })}
                      </Link>
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
