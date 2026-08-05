// 개요: 메서드 관계도 화면 — 목록·그래프·상세 3단 구성.
// 로직: 왼쪽 목록(파일별)에서 메서드를 고르면 연결된 흐름만 그래프에 그려지고,
//       연결된 호출 선들이 전이적으로 붉게 강조된다. 검색하면 일치 + 연결된 메서드를 함께 그린다.
// 참고: 큰 프로젝트는 전체를 그리지 않는다(읽을 수 없으므로) — 목록/검색에서 골라 부분 그래프를 본다.
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { reachableSet } from "../lib/graphUtils.js";
import { columnPositions, computeDepths } from "../lib/layout.js";
import { useScanStatus } from "../lib/scanStatus.js";

const FULL_RENDER_MAX = 150; // 이보다 크면 검색/선택으로 좁혀서 본다
const REACH_MAX = 120; // 연결 확장 상한 — 가까운 관계부터 이만큼만 그린다(전부 연결된 프로젝트 대비)
const LOAD_LIMIT = 10000; // 데이터는 전부 불러온다 (그리기만 선별)

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

/** 개요: 표시 대상이 바뀔 때 그래프를 화면에 맞춘다. */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 30);
    return () => clearTimeout(t);
  }, [signature, fitView]);
  return null;
}

export default function GraphPage() {
  const [params] = useSearchParams();
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FnDetail | null>(null);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const { lastScanAt } = useScanStatus(); // 코드맵이 갱신되면 다시 불러온다

  useEffect(() => {
    fetch(`/api/graph?limit=${LOAD_LIMIT}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [lastScanAt]);

  const query = q.trim().toLowerCase();

  // --- 목록: 파일별 그룹 (검색은 목록에도 적용) ------------------------
  const fileGroups = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, GraphNode[]>();
    for (const n of data.nodes) {
      if (query && !n.id.toLowerCase().includes(query)) continue;
      if (!groups.has(n.file_path)) groups.set(n.file_path, []);
      groups.get(n.file_path)!.push(n);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, query]);

  // --- 그리기 대상: 검색 일치 + 연결된 것 / 선택의 연결 집합 / 소형이면 전체
  const displayedIds = useMemo(() => {
    if (!data) return new Set<string>();
    if (selectedId) return reachableSet([selectedId], data.edges, REACH_MAX);
    if (query) {
      const matched = data.nodes
        .filter((n) => n.id.toLowerCase().includes(query))
        .map((n) => n.id);
      return reachableSet(matched, data.edges, REACH_MAX);
    }
    if (data.nodes.length <= FULL_RENDER_MAX) {
      return new Set(data.nodes.map((n) => n.id));
    }
    return new Set<string>();
  }, [data, query, selectedId]);

  // --- 붉은 강조: 선택된 메서드와 전이적으로 연결된 모든 것 --------------
  const highlighted = useMemo(() => {
    if (!data || !selectedId) return new Set<string>();
    return reachableSet([selectedId], data.edges, REACH_MAX);
  }, [data, selectedId]);

  const flow = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const visible = data.nodes.filter((n) => displayedIds.has(n.id));
    const visibleEdges = data.edges.filter(
      (e) => displayedIds.has(e.source) && displayedIds.has(e.target),
    );
    const depths = computeDepths(visible.map((n) => n.id), visibleEdges);
    const byDepth = new Map<number, GraphNode[]>();
    for (const n of visible) {
      const d = depths.get(n.id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    }
    for (const group of byDepth.values()) {
      group.sort(
        (a, b) => a.file_path.localeCompare(b.file_path) || (a.line ?? 0) - (b.line ?? 0),
      );
    }
    const positions = columnPositions(
      [...byDepth.entries()].map(([d, group]) => [d, group.map((n) => n.id)]),
      { colWidth: 260, rowHeight: 64, maxRows: 14 },
    );
    const dimOthers = highlighted.size > 0;
    const nodes: Node[] = [];
    for (const group of byDepth.values()) {
      group.forEach((n) => {
        const inHl = highlighted.has(n.id);
        const isSelected = n.id === selectedId;
        nodes.push({
          id: n.id,
          position: positions.get(n.id) ?? { x: 0, y: 0 },
          data: { label: n.name },
          style: {
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            padding: "6px 12px",
            borderRadius: 8,
            border: isSelected
              ? "2px solid var(--err-fg)"
              : inHl
                ? "1.5px solid var(--err-fg)"
                : "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            opacity: dimOthers && !inHl ? 0.18 : n.runtime_hits > 0 ? 1 : 0.6,
          },
          sourcePosition: "right" as const,
          targetPosition: "left" as const,
        });
      });
    }
    const runtimePairs = new Set(
      visibleEdges.filter((e) => e.kind === "runtime").map((e) => e.source + "→" + e.target),
    );
    const edges: Edge[] = visibleEdges
      // 같은 호출 쌍에 static과 runtime이 둘 다 있으면 runtime만 그린다
      .filter((e) => e.kind === "runtime" || !runtimePairs.has(e.source + "→" + e.target))
      .map((e) => {
        const inHl = highlighted.has(e.source) && highlighted.has(e.target);
        const base = inHl
          ? { stroke: "var(--err-fg)", strokeWidth: e.kind === "runtime" ? 2.5 : 1.8 }
          : e.kind === "runtime"
            ? { stroke: "var(--accent)", strokeWidth: Math.min(1.5 + Math.log2(e.count + 1), 6) }
            : { stroke: "var(--text-muted)", strokeDasharray: "4 3", strokeWidth: 1 };
        return {
          id: `${e.kind}:${e.source}→${e.target}`,
          source: e.source,
          target: e.target,
          style: { ...base, opacity: dimOthers && !inHl ? 0.08 : inHl ? 1 : 0.55 },
        };
      });
    return { nodes, edges };
  }, [data, displayedIds, highlighted, selectedId]);

  const selectNode = (id: string) => {
    setSelectedId(id);
    fetch(`/api/functions?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));
  };

  const toggleFile = (file: string) => {
    const next = new Set(openFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    setOpenFiles(next);
  };

  const total = data?.nodes.length ?? 0;
  const listOpen = (file: string) =>
    openFiles.has(file) || Boolean(query) || fileGroups.length <= 5;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>메서드 관계도</h1>
        <input
          className="search"
          placeholder="검색 — 일치 + 연결된 메서드까지 함께 표시"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {selectedId && (
          <button
            className="search"
            style={{ width: "auto", cursor: "pointer" }}
            onClick={() => { setSelectedId(null); setDetail(null); }}
          >
            강조 해제
          </button>
        )}
        <span className="meta">
          함수 {total}개 · 그리는 중 {displayedIds.size}개
          {displayedIds.size >= REACH_MAX && ` (연결이 많아 가까운 ${REACH_MAX}개까지)`}
        </span>
      </div>

      <div className="graph-layout">
        {/* ① 메서드 목록 (파일별) */}
        <aside className="card method-list">
          <div className="card-head"><h2>메서드</h2></div>
          <div className="method-list-body">
            {fileGroups.length === 0 && (
              <div className="panel-section">
                <span className="placeholder">
                  {query ? "검색 결과 없음" : "flowlens scan을 실행하세요."}
                </span>
              </div>
            )}
            {fileGroups.map(([file, fns]) => (
              <div key={file}>
                <button className="file-group" onClick={() => toggleFile(file)}>
                  <span className="caret">{listOpen(file) ? "▾" : "▸"}</span>
                  <span className="file-name" title={file}>{file}</span>
                  <span className="meta">{fns.length}</span>
                </button>
                {listOpen(file) &&
                  fns.map((fn) => (
                    <button
                      key={fn.id}
                      className={`method-item ${fn.id === selectedId ? "selected" : ""}`}
                      onClick={() => selectNode(fn.id)}
                      title={fn.doc_overview ?? "주석 없음"}
                    >
                      <span className={`doc-dot ${fn.doc_overview ? "yes" : "no"}`} aria-hidden>●</span>
                      <span className="method-name">{fn.name}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </aside>

        {/* ② 그래프 */}
        <div className="card" style={{ height: "72vh", minWidth: 0 }}>
          {displayedIds.size === 0 ? (
            <div className="empty" style={{ margin: 16 }}>
              {total === 0 ? (
                <>코드맵이 비어 있어요 — <code>flowlens scan</code>을 실행하세요.</>
              ) : (
                <>
                  함수가 {total}개라 한 번에 그리면 읽을 수 없어요.<br />
                  <b>왼쪽 목록에서 메서드를 고르거나 검색</b>하면 연결된 흐름만 그려드립니다.
                </>
              )}
            </div>
          ) : (
            <ReactFlowProvider>
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                onNodeClick={(_, node) => selectNode(node.id)}
                onPaneClick={() => { setSelectedId(null); setDetail(null); }}
                fitView
                minZoom={0.05}
                proOptions={{ hideAttribution: true }}
              >
                <FitOnChange signature={`${query}|${selectedId ?? ""}|${displayedIds.size}`} />
                <Background gap={24} />
                <Controls showInteractive={false} />
                {flow.nodes.length > 20 && (
                  <MiniMap
                    pannable
                    zoomable
                    style={{ background: "var(--bg)" }}
                    maskColor="color-mix(in srgb, var(--bg) 70%, transparent)"
                    nodeColor={() => "var(--bar)"}
                  />
                )}
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </div>

        {/* ③ 상세 패널 */}
        <div className="card" style={{ alignSelf: "start" }}>
          {!detail ? (
            <div className="panel-section">
              <span className="placeholder">
                메서드를 선택하면 설명이 표시되고,<br />연결된 호출 선이 붉게 강조됩니다.
              </span>
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
                        {t.entry_name} ·{" "}
                        {new Date(t.started_at * 1000).toLocaleTimeString("ko-KR", { hour12: false })}
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
