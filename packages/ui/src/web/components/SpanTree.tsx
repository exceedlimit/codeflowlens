// 개요: 호출 트리 뷰 — 들여쓰기 + 접기/펼치기 + 소요시간 바(트레이스 전체 대비 위치/길이).
import React, { useState } from "react";

import type { SpanRow } from "../api.js";
import type { TreeNode } from "../lib/tree.js";

interface Props {
  roots: TreeNode<SpanRow>[];
  traceStart: number;
  traceDuration: number; // 초 단위 전체 길이 (0이면 바 생략)
  selectedId: string | null;
  onSelect: (span: SpanRow) => void;
}

export default function SpanTree(props: Props) {
  return (
    <div>
      {props.roots.map((r) => (
        <SpanNode key={r.id} node={r} depth={0} {...props} />
      ))}
    </div>
  );
}

function SpanNode({
  node, depth, roots: _r, traceStart, traceDuration, selectedId, onSelect,
}: Props & { node: TreeNode<SpanRow>; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  const left =
    traceDuration > 0 ? ((node.started_at - traceStart) / traceDuration) * 100 : 0;
  const width =
    traceDuration > 0 && node.ended_at != null
      ? ((node.ended_at - node.started_at) / traceDuration) * 100
      : 0;
  const durMs =
    node.ended_at != null ? (node.ended_at - node.started_at) * 1000 : null;

  return (
    <div>
      <div
        className={`span-row ${selectedId === node.id ? "selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            className="caret"
            aria-label={open ? "접기" : "펼치기"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? "▼" : "▶"}
          </button>
        ) : (
          <span className="caret" />
        )}
        <span className={`fname ${node.status === "error" ? "error" : ""}`}>
          {node.name}
          {node.status === "error" && " ⚠"}
        </span>
        <span className="bar-wrap">
          <span
            className={`bar ${node.status === "error" ? "error" : ""}`}
            style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
          />
        </span>
        <span className="dur">
          {durMs == null ? "—" : durMs < 1000 ? `${durMs.toFixed(1)}ms` : `${(durMs / 1000).toFixed(2)}s`}
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <SpanNode
            key={c.id}
            node={c}
            depth={depth + 1}
            roots={_r}
            traceStart={traceStart}
            traceDuration={traceDuration}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
