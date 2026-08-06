// 개요: UI 서버 REST API 호출 계층.
export interface TraceSummary {
  id: string;
  started_at: number;
  ended_at: number | null;
  status: "running" | "ok" | "error";
  entry_kind: "process" | "http" | "event";
  entry_name: string;
  http_method: string | null;
  http_path: string | null;
  http_status: number | null;
  service: string | null;
  client_trace_id: string | null;
  span_count: number;
  duration_ms: number | null;
}

export interface SpanRow {
  id: string;
  trace_id: string;
  parent_id: string | null;
  function_id: string;
  name: string;
  started_at: number;
  ended_at: number | null;
  status: "ok" | "error";
  args_json: string | null;
  return_json: string | null;
  error_json: string | null;
  seq: number;
  doc_overview: string | null;
  doc_logic: string | null;
  doc_note: string | null;
  file_path: string | null;
  line: number | null;
  duration_ms: number | null;
}

export interface TraceListResult {
  traces: TraceSummary[];
  total: number;
  facets: { entries: string[]; services: string[] };
}

export interface TraceFilter {
  q?: string;
  entries?: string[];
  service?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export async function fetchTraces(filter: TraceFilter): Promise<TraceListResult> {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  for (const entry of filter.entries ?? []) params.append("entry", entry);
  if (filter.service) params.set("service", filter.service);
  if (filter.since) params.set("since", String(filter.since));
  if (filter.until) params.set("until", String(filter.until));
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const res = await fetch(`/api/traces?${params}`);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  return res.json();
}

export async function fetchTrace(
  id: string,
): Promise<{ trace: TraceSummary; spans: SpanRow[] }> {
  const res = await fetch(`/api/traces/${id}`);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  return res.json();
}
