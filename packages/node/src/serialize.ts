// 개요: 파라미터/리턴값을 저장 가능한 JSON 문자열로 바꾸는 직렬화기.
// 참고: 어떤 입력에도 예외를 던지지 않는다(fail-open). 파이썬 serialize.py와 동일 규칙.
const TRUNCATED = "...(truncated)";

function toJsonable(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function") return { __repr__: `[function ${(value as Function).name || "anonymous"}]` };
  if (t === "symbol") return { __repr__: String(value) };
  if (depth > 6) return { __repr__: "[deep]" };
  const obj = value as object;
  if (seen.has(obj)) return { __repr__: "[circular]" };
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.slice(0, 100).map((v) => toJsonable(v, seen, depth + 1));
    }
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Error) {
      return { __type__: obj.name, message: obj.message };
    }
    if (obj instanceof Map || obj instanceof Set) {
      return { __type__: obj.constructor.name, size: (obj as Map<unknown, unknown>).size };
    }
    const out: Record<string, unknown> = {};
    const ctor = obj.constructor?.name;
    if (ctor && ctor !== "Object") out.__type__ = ctor;
    let i = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (i++ >= 50) break;
      if (k.startsWith("_")) continue;
      out[k] = toJsonable(v, seen, depth + 1);
    }
    return out;
  } catch {
    return { __repr__: "[unserializable]" };
  } finally {
    seen.delete(obj);
  }
}

function cap(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf-8") <= maxBytes) return s;
  const buf = Buffer.from(s, "utf-8").subarray(0, maxBytes);
  return buf.toString("utf-8").replace(/�+$/, "") + TRUNCATED;
}

/** 개요: 값 하나를 저장 가능한 JSON 문자열로 바꾼다(크기 상한 적용). */
export function serializeValue(value: unknown, maxBytes = 65536): string {
  try {
    return cap(JSON.stringify(toJsonable(value, new WeakSet(), 0)) ?? "null", maxBytes);
  } catch {
    return '{"__repr__": "<unserializable>"}';
  }
}

/** 개요: 인자들을 {이름: 값} JSON으로 바꾼다 — 인자별 개별 상한. */
export function serializeArgs(args: Record<string, unknown>, maxBytes = 65536): string {
  try {
    const parts: string[] = [];
    for (const [name, v] of Object.entries(args)) {
      const s = serializeValue(v, maxBytes);
      const valid = s.endsWith(TRUNCATED) ? JSON.stringify(s) : s;
      parts.push(`${JSON.stringify(name)}: ${valid}`);
    }
    return `{${parts.join(", ")}}`;
  } catch {
    return "{}";
  }
}
