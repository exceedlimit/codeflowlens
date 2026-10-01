// 개요: 주석 커버리지 대시보드 — 룰 준수 현황과 미주석 함수 목록을 보여준다.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useScanStatus } from "../lib/scanStatus.js";

interface LangCoverage {
  language: string;
  total: number;
  documented: number;
  coverage: number;
}
interface Undocumented {
  id: string;
  language: string;
  file_path: string;
  qualified_name: string;
  line: number | null;
}

const LANG_LABEL: Record<string, string> = { python: "Python", typescript: "TypeScript" };

export default function CoveragePage() {
  const [data, setData] = useState<{
    languages: LangCoverage[]; undocumented: Undocumented[];
  } | null>(null);

  const { lastScanAt } = useScanStatus(); // 코드맵이 갱신되면 다시 불러온다

  useEffect(() => {
    fetch("/api/coverage").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, [lastScanAt]);

  if (!data) return <div className="meta">불러오는 중…</div>;
  if (data.languages.length === 0) {
    return (
      <div className="empty">
        코드맵이 비어 있어요 — <code>codeflowlens scan</code>을 실행하세요.
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>주석 커버리지</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {data.languages.map((l) => (
          <div className="card" key={l.language} style={{ padding: "14px 20px", minWidth: 180 }}>
            <div className="meta">{LANG_LABEL[l.language] ?? l.language}</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {l.coverage}%
            </div>
            <div className="meta">
              함수 {l.total}개 중 {l.documented}개 주석 있음
            </div>
          </div>
        ))}
      </div>

      {data.undocumented.length === 0 ? (
        <div className="empty">🎉 모든 함수에 비즈니스 주석이 있습니다.</div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h2>주석 없는 함수 {data.undocumented.length}개</h2>
            <span className="meta">
              코딩 에이전트에게 "codeflowlens-retrofit 스킬로 주석 소급 작업해줘"라고 요청하면 채워집니다.
            </span>
          </div>
          <div className="card-body">
            {data.undocumented.map((f) => (
              <p className="doc-line" key={f.id}>
                <Link to={`/graph?q=${encodeURIComponent(f.qualified_name)}`}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                    {f.qualified_name}
                  </span>
                </Link>
                <span className="meta"> — {f.file_path}{f.line != null && `:${f.line}`}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
