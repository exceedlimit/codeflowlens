"""
개요: 정적 분석 결과를 DB에 저장하는 계층.
로직: 한 트랜잭션에서 정적 테이블(functions, static call_edges, entities, entity_*)을
      비우고 전체 재삽입한다 — 삭제된 함수가 남는 문제를 원천 차단(PRD M2 설계).
참고: 실행 기록(traces/spans/runtime edges)은 절대 건드리지 않는다.
"""

import time


def save_scan(conn, result, language="python"):
    """개요: ScanResult를 DB에 반영한다."""
    now = time.time()
    with conn:
        # 이 언어의 정적 데이터만 지운다 — 다른 언어(예: typescript) 스캔 결과 보존
        conn.execute(
            "DELETE FROM call_edges WHERE kind='static' AND caller_id IN "
            "(SELECT id FROM functions WHERE language = ?)", (language,))
        conn.execute(
            "DELETE FROM entity_fields WHERE entity_id IN "
            "(SELECT id FROM entities WHERE language = ?)", (language,))
        conn.execute(
            "DELETE FROM entity_relations WHERE from_id IN "
            "(SELECT id FROM entities WHERE language = ?)", (language,))
        conn.execute(
            "DELETE FROM entity_usages WHERE entity_id IN "
            "(SELECT id FROM entities WHERE language = ?)", (language,))
        conn.execute("DELETE FROM entities WHERE language = ?", (language,))
        conn.execute("DELETE FROM functions WHERE language = ?", (language,))

        conn.executemany(
            "INSERT OR REPLACE INTO functions "
            "(id, language, file_path, qualified_name, line, doc_overview, doc_logic, doc_note, is_entity_method, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    f["id"], language, f["file_path"], f["qualified_name"], f["line"],
                    f["doc"].overview, f["doc"].logic, f["doc"].note,
                    1 if f["is_entity_method"] else 0, now,
                )
                for f in result.functions
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO call_edges (caller_id, callee_id, kind, count) VALUES (?,?,'static',0)",
            sorted(result.static_edges),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO entities (id, language, file_path, name, doc_overview, doc_note, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            [
                (e["id"], language, e["file_path"], e["name"],
                 e["doc"].overview, e["doc"].note, now)
                for e in result.entities
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO entity_fields (entity_id, name, type, description) VALUES (?,?,?,?)",
            [
                (e["id"], f["name"], f["type"], f["description"])
                for e in result.entities for f in e["fields"]
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO entity_relations (from_id, to_id, kind) VALUES (?,?,'ref')",
            sorted(result.relations),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO entity_usages (entity_id, function_id, role) VALUES (?,?,?)",
            sorted(result.usages),
        )


def coverage_summary(result) -> dict:
    """개요: 주석 커버리지 요약(스캔 출력용)을 만든다."""
    total = len(result.functions)
    documented = sum(1 for f in result.functions if f["doc"].overview)
    return {
        "functions": total,
        "documented": documented,
        "entities": len(result.entities),
        "coverage": round(documented / total * 100, 1) if total else 100.0,
    }
