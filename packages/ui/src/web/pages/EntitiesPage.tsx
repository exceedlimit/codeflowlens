// 개요: 엔티티 화면 — 데이터 모델의 목록/필드/관계/사용처와 전체 관계도를 보여준다.
// 로직: 관계도에서 엔티티를 클릭하면 참조로 이어진 모든 엔티티(전이적)가 붉게 강조되고
//       상세 패널이 함께 표시된다.
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { reachableSet } from "../lib/graphUtils.js";
import { columnPositions, computeDepths } from "../lib/layout.js";
import { useScanStatus } from "../lib/scanStatus.js";

interface Relation { from_id: string; to_id: string; kind: string }

// 전체보기(fit)가 큰 그래프에서도 끝까지 축소되도록 — fitView의 자체 최소 줌(기본 0.5)을 푼다
const FIT_OPTIONS = { padding: 0.15, minZoom: 0.02, maxZoom: 1.5 };

interface EntitySummary {
  id: string;
  name: string;
  file_path: string;
  doc_overview: string | null;
  field_count: number;
  usage_count: number;
}
interface EntityDetail {
  entity: EntitySummary & { doc_note: string | null };
  fields: { name: string; type: string | null; description: string | null }[];
  relations: EntitySummary[];
  used_by: {
    function_id: string;
    role: string;
    name: string | null;
    doc_overview: string | null;
    file_path: string | null;
    line: number | null;
  }[];
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); // 크게 보기 모달
  const { lastScanAt } = useScanStatus(); // 코드맵이 갱신되면 다시 불러온다

  // Esc로 크게 보기 닫기
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => r.json())
      .then((b) => {
        setEntities(b.entities);
        setRelations(b.relations ?? []);
      })
      .catch(() => setEntities([]));
  }, [lastScanAt]);

  const select = (id: string) => {
    setSelectedId(id);
    fetch(`/api/entities/detail?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));
  };

  // 선택한 엔티티와 참조로 이어진 모든 엔티티(전이적) — 붉은 강조 대상
  const highlighted = useMemo(() => {
    if (!selectedId) return new Set<string>();
    return reachableSet(
      [selectedId],
      relations.map((r) => ({ source: r.from_id, target: r.to_id })),
    );
  }, [selectedId, relations]);

  // 관계도에는 참조가 있는 엔티티만 그린다 — 고립 엔티티가 화면을 뭉개는 것 방지
  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of relations) {
      s.add(r.from_id);
      s.add(r.to_id);
    }
    return s;
  }, [relations]);

  const flow = useMemo(() => {
    if (!entities) return { nodes: [] as Node[], edges: [] as Edge[] };
    const visible = entities.filter((e) => connectedIds.has(e.id));
    const depths = computeDepths(
      visible.map((e) => e.id),
      relations.map((r) => ({ source: r.from_id, target: r.to_id })),
    );
    const byDepth = new Map<number, EntitySummary[]>();
    for (const e of visible) {
      const d = depths.get(e.id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(e);
    }
    for (const group of byDepth.values()) {
      group.sort((a, b) => a.name.localeCompare(b.name));
    }
    const positions = columnPositions(
      [...byDepth.entries()].map(([d, group]) => [d, group.map((e) => e.id)]),
      { colWidth: 250, rowHeight: 92, maxRows: 8 },
    );
    const dimOthers = highlighted.size > 0;
    const nodes: Node[] = [];
    for (const group of byDepth.values()) {
      group.forEach((e) => {
        const inHl = highlighted.has(e.id);
        nodes.push({
          id: e.id,
          position: positions.get(e.id) ?? { x: 0, y: 0 },
          data: { label: `${e.name}${e.doc_overview ? `\n${e.doc_overview}` : ""}` },
          style: {
            fontSize: 12, whiteSpace: "pre-wrap", width: 210,
            padding: "8px 10px", borderRadius: 8,
            border: e.id === selectedId
              ? "2px solid var(--err-fg)"
              : inHl
                ? "1.5px solid var(--err-fg)"
                : "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            opacity: dimOthers && !inHl ? 0.55 : 1,
          },
          sourcePosition: "right" as const,
          targetPosition: "left" as const,
        });
      });
    }
    const edges: Edge[] = relations.map((r) => {
      const inHl = highlighted.has(r.from_id) && highlighted.has(r.to_id);
      return {
        id: `${r.from_id}→${r.to_id}`,
        source: r.from_id,
        target: r.to_id,
        label: "참조",
        style: {
          stroke: inHl ? "var(--err-fg)" : "var(--accent)",
          strokeWidth: inHl ? 2.2 : 1.5,
          opacity: dimOthers && !inHl ? 0.35 : 1,
        },
      };
    });
    return { nodes, edges };
  }, [entities, relations, connectedIds, highlighted, selectedId]);

  // 그래프 본체 — 인라인 카드와 크게 보기 모달 중 한 곳에 그려진다
  const entityFlow = (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => { setSelectedId(null); setDetail(null); }}
      fitView
      fitViewOptions={FIT_OPTIONS}
      minZoom={0.02}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
    </ReactFlow>
  );

  const detailCard = (
    <div className="card" style={{ alignSelf: "start" }}>
      {!detail ? (
        <div className="panel-section">
          <span className="placeholder">
            엔티티를 선택하면 상세가 표시되고,<br />참조 관계가 붉게 강조됩니다.
          </span>
        </div>
      ) : (
        <div>
          <div className="panel-section">
            <h3>{detail.entity.name}</h3>
            <div className="meta">{detail.entity.file_path}</div>
            {detail.entity.doc_overview && (
              <p className="doc-line"><b>개요</b>{detail.entity.doc_overview}</p>
            )}
            {detail.entity.doc_note && (
              <p className="doc-line"><b>참고</b>{detail.entity.doc_note}</p>
            )}
          </div>
          <div className="panel-section">
            <h3>필드</h3>
            {detail.fields.map((f) => (
              <p className="doc-line" key={f.name}>
                <b>{f.name}</b>
                <span className="meta">{f.type} </span>
                {f.description ?? <span className="placeholder">설명 없음</span>}
              </p>
            ))}
          </div>
          {detail.relations.length > 0 && (
            <div className="panel-section">
              <h3>참조하는 엔티티</h3>
              {detail.relations.map((r) => (
                <p className="doc-line" key={r.id}>
                  <a onClick={() => select(r.id)} style={{ cursor: "pointer" }}>{r.name}</a>
                  {r.doc_overview && <span className="meta"> — {r.doc_overview}</span>}
                </p>
              ))}
            </div>
          )}
          <div className="panel-section">
            <h3>사용하는 함수</h3>
            {detail.used_by.length === 0 ? (
              <span className="placeholder">사용처 없음</span>
            ) : (
              detail.used_by.map((u) => (
                <p className="doc-line" key={u.function_id + u.role}>
                  <span className="meta">[{u.role === "param" ? "입력" : "리턴"}]</span>{" "}
                  <Link to={`/graph?q=${encodeURIComponent(u.name ?? "")}`}>{u.name ?? u.function_id}</Link>
                  {u.doc_overview && <span className="meta"> — {u.doc_overview}</span>}
                </p>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>엔티티</h1>
        <button
          className="search" style={{ width: "auto", cursor: "pointer" }}
          onClick={() => setView(view === "list" ? "graph" : "list")}
        >
          {view === "list" ? "관계도 보기" : "목록 보기"}
        </button>
        {selectedId && view === "graph" && (
          <button
            className="search" style={{ width: "auto", cursor: "pointer" }}
            onClick={() => { setSelectedId(null); setDetail(null); }}
          >
            강조 해제
          </button>
        )}
        {view === "graph" && entities && entities.length > connectedIds.size && (
          <span className="meta">
            참조 관계가 있는 {connectedIds.size}개만 표시 — 나머지 {entities.length - connectedIds.size}개는 목록에서 보세요
          </span>
        )}
      </div>

      {entities && entities.length === 0 && (
        <div className="empty">
          엔티티가 없어요 — <code>codeflowlens scan</code>을 실행하면 데이터 모델 클래스가 여기 나타납니다.
        </div>
      )}

      {view === "graph" && entities && entities.length > 0 && (
        <div className="detail-layout">
          {expanded ? (
            <div className="card" style={{ height: "72vh", minWidth: 0 }}>
              <div className="empty" style={{ margin: 16 }}>크게 보기 창이 열려 있습니다.</div>
            </div>
          ) : (
            <div className="card graph-canvas" style={{ height: "72vh", minWidth: 0 }}>
              <button
                className="graph-expand-btn"
                title="관계도를 큰 화면으로 봅니다"
                onClick={() => setExpanded(true)}
              >
                ⛶ 크게 보기
              </button>
              {entityFlow}
            </div>
          )}
          {detailCard}
        </div>
      )}

      {/* 크게 보기 모달 — 엔티티 관계도를 화면 가득 띄운다 */}
      {expanded && (
        <div className="graph-modal-overlay" onClick={() => setExpanded(false)}>
          <div className="graph-modal" onClick={(e) => e.stopPropagation()}>
            <div className="graph-modal-head">
              <b>엔티티 관계도 — 크게 보기</b>
              <span className="meta" style={{ flex: 1 }}>
                엔티티 클릭 = 참조 관계 강조 · Esc로 닫기
              </span>
              <button className="popover-close" style={{ fontSize: 16 }}
                onClick={() => setExpanded(false)}>✕</button>
            </div>
            <div className="graph-canvas graph-modal-body">{entityFlow}</div>
          </div>
        </div>
      )}

      {view === "list" && entities && entities.length > 0 && (
        <div className="detail-layout">
          <table className="traces">
            <thead>
              <tr>
                <th>이름</th><th>개요</th><th className="num">필드</th><th className="num">사용 함수</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => select(e.id)}
                  style={detail?.entity.id === e.id ? { background: "var(--selected)" } : undefined}
                >
                  <td style={{ fontFamily: "ui-monospace, monospace" }}>{e.name}</td>
                  <td>{e.doc_overview ?? <span className="placeholder">주석 없음</span>}</td>
                  <td className="num">{e.field_count}</td>
                  <td className="num">{e.usage_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detailCard}
        </div>
      )}
    </div>
  );
}
