// 개요: 메서드 관계도 화면 — 목록·그래프·상세 3단 구성.
// 로직: 왼쪽 목록(파일별)에서 메서드를 고르면 연결된 흐름이 그래프에 그려진다.
//       선은 기본 점선이고, 선택한 메서드와 "직접 연결된" 선·노드만 붉게 강조된다
//       (복잡한 그림에서 어디와 연결됐는지 확인하는 용도). 노드를 클릭하면 옆에 설명 카드가 뜬다.
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { reachableSet } from "../lib/graphUtils.js";
import { columnPositions, computeDepths } from "../lib/layout.js";
import { groupByFile, matchesQuery, sliceGroups } from "../lib/methodList.js";
import { useScanStatus } from "../lib/scanStatus.js";

const FULL_RENDER_MAX = 150; // 이보다 크면 검색/선택으로 좁혀서 본다
const REACH_MAX = 120; // 연결 확장 상한 — 가까운 관계부터 이만큼만 그린다(전부 연결된 프로젝트 대비)
const LOAD_LIMIT = 10000; // 데이터는 전부 불러온다 (그리기만 선별)
const LIST_BUDGET = 120; // 목록은 이 행 수만큼만 먼저 그리고, 스크롤하면 이어 그린다
const SEARCH_DEBOUNCE_MS = 200; // 타이핑마다 수천 개를 다시 계산하지 않도록 잠깐 기다린다

// 전체보기(fit)가 큰 그래프에서도 끝까지 축소되도록 — fitView의 자체 최소 줌(기본 0.5)을 푼다
const FIT_OPTIONS = { padding: 0.15, minZoom: 0.02, maxZoom: 1.5 };

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
    const t = setTimeout(() => fitView({ ...FIT_OPTIONS, duration: 300 }), 30);
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
  const [popover, setPopover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(false); // 크게 보기 모달
  const [listBudget, setListBudget] = useState(LIST_BUDGET); // 목록 인피니티 스크롤 예산
  const [debouncedQ, setDebouncedQ] = useState(q);
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const listBodyRef = useRef<HTMLDivElement | null>(null);

  // 검색은 잠깐 기다렸다 반영 — 입력은 즉시, 무거운 재계산은 디바운스 후에
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Esc로 크게 보기 닫기
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);
  const { lastScanAt } = useScanStatus(); // 코드맵이 갱신되면 다시 불러온다

  useEffect(() => {
    fetch(`/api/graph?limit=${LOAD_LIMIT}`)
      .then((r) => r.json())
      .then((b) => {
        setData(b);
        // 파일이 적으면 목록을 처음부터 펼쳐둔다
        const files = new Set<string>((b.nodes as GraphNode[]).map((n) => n.file_path));
        if (files.size <= 5) setOpenFiles(files);
      })
      // 실패 시 빈 상태로 — null(불러오는 중)에 머물지 않게
      .catch(() => setData({ nodes: [], edges: [], truncated: false }));
  }, [lastScanAt]);

  const query = debouncedQ.trim().toLowerCase();

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of data?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [data]);

  // --- 목록: 파일별 그룹 (검색은 이름·파일·설명(개요)에 적용) -----------
  const fileGroups = useMemo(() => {
    if (!data) return [];
    return groupByFile(data.nodes.filter((n) => matchesQuery(n, query)));
  }, [data, query]);

  // 검색이 바뀌면 목록 스크롤 예산을 처음부터 다시
  useEffect(() => {
    setListBudget(LIST_BUDGET);
    listBodyRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // --- 그리기 대상: 선택의 연결 집합 / 검색 일치 + 연결 / 소형이면 전체
  const displayedIds = useMemo(() => {
    if (!data) return new Set<string>();
    if (selectedId) return reachableSet([selectedId], data.edges, REACH_MAX);
    if (query) {
      const matched = data.nodes
        .filter((n) => matchesQuery(n, query))
        .map((n) => n.id);
      return reachableSet(matched, data.edges, REACH_MAX);
    }
    if (data.nodes.length <= FULL_RENDER_MAX) {
      return new Set(data.nodes.map((n) => n.id));
    }
    return new Set<string>();
  }, [data, query, selectedId]);

  // --- 붉은 강조: 선택한 메서드와 "직접" 연결된 노드들 (1단계) -----------
  const directNeighbors = useMemo(() => {
    if (!data || !selectedId) return new Set<string>();
    const s = new Set<string>([selectedId]);
    for (const e of data.edges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    return s;
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
    const hasSelection = selectedId != null;
    const nodes: Node[] = [];
    for (const group of byDepth.values()) {
      group.forEach((n) => {
        const isSelected = n.id === selectedId;
        const isNeighbor = directNeighbors.has(n.id) && !isSelected;
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
              : isNeighbor
                ? "1.5px solid var(--err-fg)"
                : "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            opacity: hasSelection && !isSelected && !isNeighbor
              ? 0.55
              : n.runtime_hits > 0 ? 1 : 0.85,
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
      // 같은 호출 쌍에 static과 runtime이 둘 다 있으면 하나만 그린다
      .filter((e) => e.kind === "runtime" || !runtimePairs.has(e.source + "→" + e.target))
      .map((e) => {
        // 직접 연결된 선만 붉게 — 나머지는 기본 점선
        const inHl = e.source === selectedId || e.target === selectedId;
        return {
          id: `${e.kind}:${e.source}→${e.target}`,
          source: e.source,
          target: e.target,
          style: inHl
            ? { stroke: "var(--err-fg)", strokeWidth: 2.2, opacity: 1 }
            : {
                stroke: "var(--text-muted)",
                strokeDasharray: "4 3",
                strokeWidth: 1,
                opacity: hasSelection ? 0.4 : 0.7,
              },
        };
      });
    return { nodes, edges };
  }, [data, displayedIds, directNeighbors, selectedId]);

  const selectNode = (id: string) => {
    setSelectedId(id);
    fetch(`/api/functions?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));
  };

  /** 개요: 그래프 안에서 노드를 클릭하면 그 옆에 설명 카드를 띄운다. */
  const onGraphNodeClick = (event: React.MouseEvent, node: Node) => {
    selectNode(node.id);
    const rect = graphWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(event.clientX - rect.left + 14, rect.width - 320);
    const y = Math.min(event.clientY - rect.top - 8, rect.height - 180);
    setPopover({ id: node.id, x: Math.max(8, x), y: Math.max(8, y) });
  };

  const clearSelection = () => {
    setSelectedId(null);
    setDetail(null);
    setPopover(null);
  };

  const total = data?.nodes.length ?? 0;
  const loading = data === null;
  const allFiles = useMemo(() => fileGroups.map(([f]) => f), [fileGroups]);
  const listOpen = (file: string) => Boolean(query) || openFiles.has(file);
  const popoverNode = popover ? nodeById.get(popover.id) : null;

  // 그룹 헤더에는 잘린 개수가 아니라 파일의 전체 메서드 수를 보여준다
  const groupTotals = useMemo(
    () => new Map(fileGroups.map(([f, fns]) => [f, fns.length])),
    [fileGroups],
  );

  // 목록은 예산만큼만 그린다 — 하단 센티널이 보이면 예산을 늘려 이어 그린다
  const { groups: shownGroups, hasMore } = useMemo(
    () => sliceGroups(fileGroups, listOpen, listBudget),
    // listOpen은 openFiles·query에서 파생된다
    [fileGroups, openFiles, query, listBudget],
  );

  // 목록 바닥 근처까지 스크롤하면 예산을 늘려 이어 그린다
  const onListScroll = () => {
    if (!hasMore) return;
    const el = listBodyRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      setListBudget((b) => b + LIST_BUDGET);
    }
  };

  // 그래프 본체 — 인라인 카드와 크게 보기 모달 중 한 곳에 그려진다
  const graphInner = (
    <>
      {displayedIds.size === 0 ? (
        <div className="empty" style={{ margin: 16 }}>
          {loading ? (
            <>코드맵 불러오는 중…</>
          ) : total === 0 ? (
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
            onNodeClick={onGraphNodeClick}
            onPaneClick={clearSelection}
            onMoveStart={() => setPopover(null)}
            fitView
            fitViewOptions={FIT_OPTIONS}
            minZoom={0.02}
            proOptions={{ hideAttribution: true }}
          >
            <FitOnChange
              signature={`${query}|${selectedId ?? ""}|${displayedIds.size}|${expanded}`}
            />
            <Background gap={24} />
            <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
          </ReactFlow>
        </ReactFlowProvider>
      )}

      {/* 노드 옆 오버레이 설명 카드 */}
      {popoverNode && popover && (
        <div className="graph-popover" style={{ left: popover.x, top: popover.y }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <b style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
              {popoverNode.name}
            </b>
            <span className="meta" style={{ flex: 1 }}>
              {popoverNode.file_path}
              {popoverNode.line != null && `:${popoverNode.line}`}
            </span>
            <button className="popover-close" onClick={() => setPopover(null)}>✕</button>
          </div>
          {popoverNode.doc_overview ? (
            <>
              <p className="doc-line"><b>개요</b>{popoverNode.doc_overview}</p>
              {popoverNode.doc_logic && (
                <p className="doc-line"><b>로직</b>{popoverNode.doc_logic}</p>
              )}
              {popoverNode.doc_note && (
                <p className="doc-line"><b>참고</b>{popoverNode.doc_note}</p>
              )}
            </>
          ) : (
            <p className="placeholder" style={{ margin: "4px 0 0" }}>주석 없음</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>메서드 관계도</h1>
        <input
          className="search"
          placeholder="검색 — 이름·파일·설명(개요), 연결된 메서드까지 표시"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {selectedId && (
          <button
            className="search"
            style={{ width: "auto", cursor: "pointer" }}
            onClick={clearSelection}
          >
            강조 해제
          </button>
        )}
        <span className="meta">
          {loading ? (
            "코드맵 불러오는 중…"
          ) : (
            <>
              함수 {total}개 · 그리는 중 {displayedIds.size}개
              {displayedIds.size >= REACH_MAX && ` (연결이 많아 가까운 ${REACH_MAX}개까지)`}
            </>
          )}
        </span>
      </div>

      <div className="graph-layout">
        {/* ① 메서드 목록 (파일별) */}
        <aside className="card method-list">
          <div className="card-head" style={{ gap: 6 }}>
            <h2 style={{ flex: 1 }}>메서드</h2>
            <button className="list-tool" title="모두 펼치기"
              onClick={() => setOpenFiles(new Set(allFiles))}>▾ 펼치기</button>
            <button className="list-tool" title="모두 닫기"
              onClick={() => setOpenFiles(new Set())}>▸ 닫기</button>
          </div>
          <div className="method-list-body" ref={listBodyRef} onScroll={onListScroll}>
            {fileGroups.length === 0 && (
              <div className="panel-section">
                <span className="placeholder">
                  {loading ? "코드맵 불러오는 중…" : query ? "검색 결과 없음" : "flowlens scan을 실행하세요."}
                </span>
              </div>
            )}
            {shownGroups.map(([file, fns]) => (
              <div key={file}>
                <button
                  className="file-group"
                  onClick={() => {
                    const next = new Set(openFiles);
                    if (next.has(file)) next.delete(file);
                    else next.add(file);
                    setOpenFiles(next);
                  }}
                >
                  <span className="caret">{listOpen(file) ? "▾" : "▸"}</span>
                  <span className="file-name" title={file}>{file}</span>
                  <span className="meta">{groupTotals.get(file) ?? fns.length}</span>
                </button>
                {listOpen(file) &&
                  fns.map((fn) => (
                    <button
                      key={fn.id}
                      className={`method-item ${fn.id === selectedId ? "selected" : ""}`}
                      onClick={() => { setPopover(null); selectNode(fn.id); }}
                      title={fn.doc_overview ?? "주석 없음"}
                    >
                      <span className={`doc-dot ${fn.doc_overview ? "yes" : "no"}`} aria-hidden>●</span>
                      <span className="method-name">{fn.name}</span>
                    </button>
                  ))}
              </div>
            ))}
            {hasMore && (
              <div className="panel-section meta" style={{ textAlign: "center" }}>
                더 불러오는 중…
              </div>
            )}
          </div>
        </aside>

        {/* ② 그래프 (크게 보기 중에는 모달이 대신 그린다) */}
        {expanded ? (
          <div className="card graph-canvas">
            <div className="empty" style={{ margin: 16 }}>크게 보기 창이 열려 있습니다.</div>
          </div>
        ) : (
          <div ref={graphWrapRef} className="card graph-canvas">
            {displayedIds.size > 0 && (
              <button
                className="graph-expand-btn"
                title="관계도를 큰 화면으로 봅니다"
                onClick={() => { setPopover(null); setExpanded(true); }}
              >
                ⛶ 크게 보기
              </button>
            )}
            {graphInner}
          </div>
        )}

        {/* ③ 상세 패널 */}
        <div className="card detail-panel">
          {!detail ? (
            <div className="panel-section">
              <span className="placeholder">
                메서드를 선택하면 설명이 표시되고,<br />직접 연결된 호출 선이 붉게 강조됩니다.
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

      {/* 크게 보기 모달 — 관계도를 화면 가득 띄운다 */}
      {expanded && (
        <div className="graph-modal-overlay" onClick={() => setExpanded(false)}>
          <div className="graph-modal" onClick={(e) => e.stopPropagation()}>
            <div className="graph-modal-head">
              <b>메서드 관계도 — 크게 보기</b>
              <span className="meta" style={{ flex: 1 }}>
                그리는 중 {displayedIds.size}개 · 노드 클릭 = 설명 카드 · Esc로 닫기
              </span>
              <button className="popover-close" style={{ fontSize: 16 }}
                onClick={() => setExpanded(false)}>✕</button>
            </div>
            <div ref={graphWrapRef} className="graph-canvas graph-modal-body">
              {graphInner}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
