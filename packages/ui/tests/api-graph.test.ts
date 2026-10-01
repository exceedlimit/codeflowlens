// 개요: 관계도/엔티티/함수 API 테스트 — 정적 분석 데이터가 담긴 픽스처 DB로 검증한다.
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server/api.js";

const SCHEMA = readFileSync(
  new URL("../../schema/schema.sql", import.meta.url),
  "utf-8",
);

const T0 = Date.now() / 1000 - 60; // 정리 스케줄러에 지워지지 않는 최근 시각


let server: Awaited<ReturnType<typeof buildServer>>;

function seed(path: string) {
  const db = new Database(path);
  db.exec(SCHEMA);
  const fn = db.prepare(
    `INSERT INTO functions (id, language, file_path, qualified_name, line, doc_overview, doc_logic)
     VALUES (?, 'python', ?, ?, ?, ?, ?)`,
  );
  fn.run("app/service.py::create_order", "app/service.py", "create_order", 10,
    "주문을 생성한다.", "재고를 확인하고 저장한다.");
  fn.run("app/repo.py::save_order", "app/repo.py", "save_order", 5, "주문을 저장한다.", "덮어쓴다.");
  fn.run("app/repo.py::get_stock", "app/repo.py", "get_stock", 1, null, null);

  db.prepare(
    "INSERT INTO call_edges VALUES ('app/service.py::create_order', 'app/repo.py::save_order', 'static', 0)",
  ).run();
  db.prepare(
    "INSERT INTO call_edges VALUES ('app/service.py::create_order', 'app/repo.py::save_order', 'runtime', 7)",
  ).run();

  db.prepare(
    `INSERT INTO entities (id, language, file_path, name, doc_overview, doc_note)
     VALUES ('app/models.py::Order', 'python', 'app/models.py', 'Order', '주문 엔티티.', '취소 시 수량 0.')`,
  ).run();
  db.prepare(
    `INSERT INTO entities (id, language, file_path, name, doc_overview)
     VALUES ('app/models.py::Stock', 'python', 'app/models.py', 'Stock', '재고 엔티티.')`,
  ).run();
  db.prepare(
    "INSERT INTO entity_fields VALUES ('app/models.py::Order', 'order_id', 'str', '주문 번호')",
  ).run();
  db.prepare(
    "INSERT INTO entity_relations VALUES ('app/models.py::Order', 'app/models.py::Stock', 'ref')",
  ).run();
  db.prepare(
    "INSERT INTO entity_usages VALUES ('app/models.py::Order', 'app/service.py::create_order', 'return')",
  ).run();

  db.prepare(
    `INSERT INTO traces (id, started_at, ended_at, status, entry_kind, entry_name)
     VALUES ('t1', ${T0}, ${T0 + 0.5}, 'ok', 'http', 'POST /orders')`,
  ).run();
  db.prepare(
    `INSERT INTO spans (id, trace_id, function_id, name, started_at, ended_at, status, seq)
     VALUES ('s1', 't1', 'app/service.py::create_order', 'create_order', ${T0}, ${T0 + 0.4}, 'ok', 0)`,
  ).run();
  db.close();
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeflowlens-graph-test-"));
  const dbPath = join(dir, "data.db");
  seed(dbPath);
  server = await buildServer({ dbPath });
});

afterAll(async () =>
  server.close());

describe("GET /api/graph", () => {
  it("노드(주석 유무·실행 횟수)와 엣지(static/runtime)를 돌려준다", async () => {
    const res = await server.inject({ url: "/api/graph" });
    expect(res.statusCode).toBe(200);
    const { nodes, edges } = res.json();
    expect(nodes).toHaveLength(3);
    const create = nodes.find((n: any) => n.id === "app/service.py::create_order");
    expect(create.doc_overview).toBe("주문을 생성한다.");
    expect(create.runtime_hits).toBe(1); // 스팬 1건
    const stock = nodes.find((n: any) => n.id === "app/repo.py::get_stock");
    expect(stock.doc_overview).toBeNull();
    expect(stock.runtime_hits).toBe(0);
    expect(edges).toContainEqual({
      source: "app/service.py::create_order",
      target: "app/repo.py::save_order",
      kind: "runtime",
      count: 7,
    });
  });

  it("q 필터가 이름/파일에 적용된다", async () => {
    const res = await server.inject({ url: "/api/graph?q=repo" });
    const { nodes } = res.json();
    expect(nodes.every((n: any) => n.id.includes("repo"))).toBe(true);
  });

  it("limit 파라미터로 상한을 조절할 수 있다", async () => {
    const res = await server.inject({ url: "/api/graph?limit=2" });
    const body = res.json();
    expect(body.nodes).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });
});

describe("GET /api/entities", () => {
  it("목록에 필드 수·사용 함수 수가 포함된다", async () => {
    const res = await server.inject({ url: "/api/entities" });
    const { entities } = res.json();
    expect(entities).toHaveLength(2);
    const order = entities.find((e: any) => e.name === "Order");
    expect(order.field_count).toBe(1);
    expect(order.usage_count).toBe(1);
  });

  it("상세는 필드/관계/사용 함수를 돌려준다", async () => {
    const res = await server.inject({
      url: "/api/entities/detail?id=" + encodeURIComponent("app/models.py::Order"),
    });
    const body = res.json();
    expect(body.entity.doc_note).toBe("취소 시 수량 0.");
    expect(body.fields[0]).toMatchObject({ name: "order_id", description: "주문 번호" });
    expect(body.relations[0].name).toBe("Stock");
    expect(body.used_by[0]).toMatchObject({
      function_id: "app/service.py::create_order",
      role: "return",
    });
  });
});

describe("GET /api/functions", () => {
  it("함수 상세와 관련 트레이스 최근 목록을 돌려준다", async () => {
    const res = await server.inject({
      url: "/api/functions?id=" + encodeURIComponent("app/service.py::create_order"),
    });
    const body = res.json();
    expect(body.function.doc_logic).toBe("재고를 확인하고 저장한다.");
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0].entry_name).toBe("POST /orders");
  });

  it("없는 함수는 404", async () => {
    const res = await server.inject({ url: "/api/functions?id=nope" });
    expect(res.statusCode).toBe(404);
  });
});
