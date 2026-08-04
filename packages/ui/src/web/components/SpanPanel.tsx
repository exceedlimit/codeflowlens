// 개요: 선택한 스팬의 상세 패널 — 비즈니스 주석(개요/로직/참고) + 파라미터/리턴값 + 에러.
import React from "react";

import type { SpanRow } from "../api.js";

function pretty(jsonText: string | null): string {
  if (jsonText == null) return "—";
  try {
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch {
    return jsonText; // 잘린 값 등 JSON이 아닌 경우 원문 표시
  }
}

export default function SpanPanel({ span }: { span: SpanRow | null }) {
  if (!span) {
    return (
      <div className="panel-section">
        <span className="placeholder">왼쪽 트리에서 함수를 선택하세요.</span>
      </div>
    );
  }
  const hasDocs = span.doc_overview || span.doc_logic || span.doc_note;
  const err = span.error_json ? JSON.parse(span.error_json) : null;
  return (
    <div>
      <div className="panel-section">
        <h3>함수</h3>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
          {span.name}
        </div>
        <div className="meta">
          {span.function_id}
          {span.line != null && `:${span.line}`}
        </div>
      </div>

      <div className="panel-section">
        <h3>설명</h3>
        {hasDocs ? (
          <>
            {span.doc_overview && (
              <p className="doc-line"><b>개요</b>{span.doc_overview}</p>
            )}
            {span.doc_logic && (
              <p className="doc-line"><b>로직</b>{span.doc_logic}</p>
            )}
            {span.doc_note && (
              <p className="doc-line"><b>참고</b>{span.doc_note}</p>
            )}
          </>
        ) : (
          <span className="placeholder">
            주석 없음 — flowlens scan으로 코드맵을 갱신하거나 주석을 추가하세요.
          </span>
        )}
      </div>

      {err && (
        <div className="panel-section">
          <h3>에러</h3>
          <pre>{err.type}: {err.message}</pre>
        </div>
      )}

      <div className="panel-section">
        <h3>파라미터</h3>
        <pre>{pretty(span.args_json)}</pre>
      </div>

      <div className="panel-section">
        <h3>리턴값</h3>
        <pre>{pretty(span.return_json)}</pre>
      </div>
    </div>
  );
}
