// 개요: JSDoc 비즈니스 주석의 라벨(개요/로직/참고/파라미터)을 구조화하는 파서.
// 참고: 파이썬 docparse.py와 동일 규칙 — 라벨 없는 첫 줄은 개요로 간주(기존 주석 수용).
export interface ParsedDoc {
  overview: string | null;
  logic: string | null;
  note: string | null;
  fields: Record<string, string>;
}

const LABEL_RE =
  /^\s*(개요|로직|참고|파라미터|Overview|Logic|Note|Fields|Params)\s*[:：]\s*(.*)$/i;
const FIELD_RE = /^\s*[-*]\s*([\w가-힣]+)\s*[:：]\s*(.+)$/;

const ALIASES: Record<string, "overview" | "logic" | "note" | "fields"> = {
  "개요": "overview", overview: "overview",
  "로직": "logic", logic: "logic",
  "참고": "note", note: "note",
  "파라미터": "fields", fields: "fields", params: "fields",
};

export function parseDoc(text: string | null | undefined): ParsedDoc {
  const result: ParsedDoc = { overview: null, logic: null, note: null, fields: {} };
  if (!text) return result;
  try {
    const sections: Record<"overview" | "logic" | "note", string[]> = {
      overview: [], logic: [], note: [],
    };
    let current: "overview" | "logic" | "note" | "fields" | null = null;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/^\s*\*\s?/, "").trim(); // JSDoc의 선행 '*' 제거
      if (!line) continue;
      const m = LABEL_RE.exec(line);
      if (m) {
        current = ALIASES[m[1].toLowerCase()] ?? ALIASES[m[1]];
        const rest = m[2].trim();
        if (current === "fields") continue;
        if (rest && current) sections[current].push(rest);
        continue;
      }
      if (current === "fields") {
        const fm = FIELD_RE.exec(line);
        if (fm) result.fields[fm[1]] = fm[2].trim();
        continue;
      }
      if (current === null) current = "overview";
      sections[current as "overview" | "logic" | "note"].push(line);
    }
    result.overview = sections.overview.join(" ") || null;
    result.logic = sections.logic.join(" ") || null;
    result.note = sections.note.join(" ") || null;
  } catch { /* fail-open */ }
  return result;
}
