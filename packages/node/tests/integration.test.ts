// 개요: 로더 훅/HTTP 그룹핑/CLI 통합 테스트 — 실제 subprocess로 추적 전체 경로를 검증한다.
import Database from "better-sqlite3";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const PKG = join(__dirname, "..");
const REGISTER = pathToFileURL(join(PKG, "dist", "register.mjs")).href;

const ESM_APP = `
function inner(x, y) { return x + y }
function outer(n) { return inner(n, n) }
console.log(outer(21))
`;

const CJS_APP = `
function double(v) { return v * 2 }
console.log(double(4))
`;

const HTTP_APP = `
import http from "node:http"
function compute(n) { return n * 2 }
async function handle(req, res) {
  res.end(JSON.stringify({ v: compute(3) }))
}
const srv = http.createServer((req, res) => { handle(req, res) })
srv.listen(0, async () => {
  const port = srv.address().port
  await fetch("http://127.0.0.1:" + port + "/orders?x=1", { headers: { "x-flowlens-trace": "cli-1" } })
  await fetch("http://127.0.0.1:" + port + "/orders")
  srv.close(() => process.exit(0))
})
`;

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "flowlens-int-"));
  writeFileSync(join(dir, "package.json"), "{}");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function runTraced(dir: string, entry: string): string {
  return execSync(`node --import "${REGISTER}" ${entry}`, {
    cwd: dir,
    encoding: "utf-8",
    timeout: 60_000,
    env: {
      ...process.env,
      FLOWLENS_ENABLED: "1",
      FLOWLENS_DB: join(dir, ".flowlens", "data.db"),
      FLOWLENS_PROJECT_ROOT: dir,
    },
  });
}

function openDb(dir: string): Database.Database {
  return new Database(join(dir, ".flowlens", "data.db"), { readonly: true });
}

beforeAll(() => {
  execSync("npm run build", { cwd: PKG, timeout: 120_000 });
}, 150_000);

describe("로더 훅 통합", () => {
  it("ESM 앱의 함수 호출이 기록된다 (부모/인자/리턴 포함)", () => {
    const dir = makeProject({ "app.mjs": ESM_APP });
    const out = runTraced(dir, "app.mjs");
    expect(out.trim()).toBe("42");
    const db = openDb(dir);
    const spans = db.prepare("SELECT * FROM spans ORDER BY seq").all() as any[];
    const outer = spans.find((s) => s.name === "outer");
    const inner = spans.find((s) => s.name === "inner");
    expect(outer.function_id).toBe("app.mjs::outer");
    expect(inner.parent_id).toBe(outer.id);
    expect(JSON.parse(inner.args_json)).toEqual({ x: 21, y: 21 });
    expect(JSON.parse(outer.return_json)).toBe(42);
    expect(
      (db.prepare("SELECT status FROM traces WHERE entry_kind='process'").get() as any).status,
    ).toBe("ok");
    db.close();
  });

  it("CJS(require 경로) 앱도 기록된다", () => {
    const dir = makeProject({ "app.cjs": CJS_APP });
    const out = runTraced(dir, "app.cjs");
    expect(out.trim()).toBe("8");
    const db = openDb(dir);
    const names = (db.prepare("SELECT name FROM spans").all() as any[]).map((r) => r.name);
    expect(names).toContain("double");
    db.close();
  });

  it("환경변수 없이 실행하면 아무 흔적도 없다(오버헤드 0)", () => {
    const dir = makeProject({ "app.mjs": ESM_APP });
    execSync(`node --import "${REGISTER}" app.mjs`, {
      cwd: dir, encoding: "utf-8", timeout: 60_000,
      env: { ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("FLOWLENS")),
      ) },
    });
    expect(existsSync(join(dir, ".flowlens"))).toBe(false);
  });
});

describe("TS 네이티브 실행", () => {
  it("Node가 직접 실행하는 .ts 파일도 계측된다 (타입 제거 + 계측)", () => {
    const dir = makeProject({
      "app.ts": `
interface Order { id: string; qty: number }
function total(o: Order): number { return o.qty * 2 }
function main(): number { return total({ id: "a", qty: 21 }) }
console.log(main())
`,
    });
    const out = runTraced(dir, "app.ts");
    expect(out.trim()).toBe("42");
    const db = openDb(dir);
    const spans = db.prepare("SELECT * FROM spans ORDER BY seq").all() as any[];
    const main = spans.find((s) => s.name === "main");
    const total = spans.find((s) => s.name === "total");
    expect(main.function_id).toBe("app.ts::main");
    expect(total.parent_id).toBe(main.id);
    expect(JSON.parse(total.args_json).o).toEqual({ id: "a", qty: 21 });
    db.close();
  });
});

describe("http 요청 그룹핑", () => {
  it("요청 1건 = http 트레이스 1건, 핸들러 스팬 포함, 헤더 연결", () => {
    const dir = makeProject({ "server.mjs": HTTP_APP });
    runTraced(dir, "server.mjs");
    const db = openDb(dir);
    const traces = db
      .prepare("SELECT * FROM traces WHERE entry_kind='http' ORDER BY started_at")
      .all() as any[];
    expect(traces).toHaveLength(2);
    expect(traces[0].entry_name).toBe("GET /orders");
    expect(traces[0].http_status).toBe(200);
    expect(traces[0].client_trace_id).toBe("cli-1");
    for (const t of traces) {
      const names = (db.prepare("SELECT name FROM spans WHERE trace_id=?").all(t.id) as any[])
        .map((r) => r.name);
      expect(names).toContain("handle");
      expect(names).toContain("compute");
    }
    db.close();
  });
});

describe("value_max_bytes 설정 반영", () => {
  it("설정된 상한으로 인자가 잘린다", () => {
    const dir = makeProject({
      "app.mjs": `
function eat(data) { return data.length }
console.log(eat("x".repeat(50000)))
`,
    });
    // 설정이 든 DB를 미리 만들어 둔다
    const dbPath = join(dir, ".flowlens", "data.db");
    mkdirSync(join(dir, ".flowlens"), { recursive: true });
    const pre = new Database(dbPath);
    pre.exec(readFileSync(join(PKG, "src", "db", "schema.sql"), "utf-8"));
    pre.prepare("INSERT INTO schema_version VALUES (1)").run();
    pre.prepare("INSERT INTO settings VALUES ('value_max_bytes', '2000')").run();
    pre.close();

    runTraced(dir, "app.mjs");
    const db = openDb(dir);
    const row = db.prepare("SELECT args_json FROM spans WHERE name='eat'").get() as any;
    expect(Buffer.byteLength(row.args_json)).toBeLessThan(2300);
    expect(row.args_json).toContain("truncated");
    db.close();
  });
});

describe("flowlens CLI", () => {
  it("run이 NODE_OPTIONS 주입으로 자식을 추적한다", () => {
    const dir = makeProject({ "app.mjs": ESM_APP });
    const out = execSync(`node "${join(PKG, "dist", "cli.js")}" run node app.mjs`, {
      cwd: dir, encoding: "utf-8", timeout: 60_000,
    });
    expect(out.trim()).toBe("42");
    expect(existsSync(join(dir, ".flowlens", "data.db"))).toBe(true);
  });
});
