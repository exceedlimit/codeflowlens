// 개요: 엔티티 화면 — 데이터 모델의 목록/필드/관계/사용처를 보여준다.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
  const [detail, setDetail] = useState<EntityDetail | null>(null);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => r.json())
      .then((b) => setEntities(b.entities))
      .catch(() => setEntities([]));
  }, []);

  const select = (id: string) =>
    fetch(`/api/entities/detail?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));

  return (
    <div>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>엔티티</h1>
      {entities && entities.length === 0 && (
        <div className="empty">
          엔티티가 없어요 — <code>flowlens scan</code>을 실행하면 데이터 모델 클래스가 여기 나타납니다.
        </div>
      )}
      {entities && entities.length > 0 && (
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

          <div className="card" style={{ alignSelf: "start" }}>
            {!detail ? (
              <div className="panel-section">
                <span className="placeholder">엔티티를 선택하면 상세가 표시됩니다.</span>
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
        </div>
      )}
    </div>
  );
}
