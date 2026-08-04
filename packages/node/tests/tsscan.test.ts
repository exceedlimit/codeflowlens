// 개요: TS 정적 분석기 테스트 — 함수/엔티티/호출관계/사용처 추출을 검증한다.
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseDoc } from "../src/analyzer/docparse.js";
import { openDb, saveScan } from "../src/analyzer/store.js";
import { findViolations } from "../src/analyzer/scan-cli.js";
import { scanProject, type ScanResult } from "../src/analyzer/tsscan.js";

const MODELS = `
/**
 * 개요: 주문 엔티티.
 * 파라미터:
 *   - orderId: 주문 번호
 *   - quantity: 주문 수량
 * 참고: 취소 시 수량 0.
 */
export interface Order {
  orderId: string
  quantity: number
}

/**
 * 개요: 영수증.
 * 파라미터:
 *   - order: 원본 주문
 */
export type Receipt = {
  order: Order
}
`;

const SERVICE = `
import type { Order, Receipt } from "./models.js"

/**
 * 개요: 주문을 생성한다.
 * 로직: 검증하고 저장한다.
 */
export function createOrder(order: Order): Receipt {
  validate(order)
  return save(order)
}

/**
 * 개요: 주문을 검증한다.
 * 로직: 수량이 양수인지 본다.
 */
function validate(order: Order): void {}

/**
 * 개요: 주문을 저장한다.
 * 로직: 저장소에 넘긴다.
 */
const save = (order: Order): Receipt => ({ order })

export class OrderService {
  /**
   * 개요: 주문을 취소한다.
   * 로직: 상태를 바꾸고 다시 저장한다.
   */
  cancel(id: string): void {
    this.reload(id)
  }

  /** 개요: 주문을 다시 읽는다.
   *  로직: 저장소에서 조회한다. */
  reload(id: string): void {}
}

export function noDocs(x: number) { return x }
`;

let root: string;
let result: ScanResult;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "flowlens-tsscan-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "src", "models.ts"), MODELS);
  writeFileSync(join(root, "src", "service.ts"), SERVICE);
  writeFileSync(join(root, "node_modules", "dep", "i.js"), "export function hidden(){}");
  result = scanProject(root);
});

describe("parseDoc (JSDoc)", () => {
  it("선행 *와 라벨을 처리한다", () => {
    const d = parseDoc(" * 개요: 무언가 한다.\n * 로직: 이렇게 한다.");
    expect(d.overview).toBe("무언가 한다.");
    expect(d.logic).toBe("이렇게 한다.");
  });
});

describe("scanProject", () => {
  it("함수/메서드/화살표 상수가 fid·주석과 함께 추출된다", () => {
    const ids = result.functions.map((f) => f.id);
    expect(ids).toContain("src/service.ts::createOrder");
    expect(ids).toContain("src/service.ts::save");
    expect(ids).toContain("src/service.ts::OrderService.cancel");
    expect(ids.some((i) => i.includes("hidden"))).toBe(false);
    const create = result.functions.find((f) => f.id === "src/service.ts::createOrder")!;
    expect(create.doc.overview).toBe("주문을 생성한다.");
    expect(create.doc.logic).toBe("검증하고 저장한다.");
  });

  it("호출 관계가 보수적으로 매칭된다 (this 포함)", () => {
    expect(result.staticEdges).toContainEqual([
      "src/service.ts::createOrder", "src/service.ts::validate",
    ]);
    expect(result.staticEdges).toContainEqual([
      "src/service.ts::OrderService.cancel", "src/service.ts::OrderService.reload",
    ]);
  });

  it("interface/type 엔티티와 필드 설명이 추출된다", () => {
    const order = result.entities.find((e) => e.name === "Order")!;
    expect(order.doc.note).toBe("취소 시 수량 0.");
    const f = order.fields.find((x) => x.name === "orderId")!;
    expect(f.type).toBe("string");
    expect(f.description).toBe("주문 번호");
    expect(result.relations).toContainEqual([
      "src/models.ts::Receipt", "src/models.ts::Order",
    ]);
  });

  it("함수의 엔티티 사용(param/return)이 추출된다", () => {
    expect(result.usages).toContainEqual([
      "src/models.ts::Order", "src/service.ts::createOrder", "param",
    ]);
    expect(result.usages).toContainEqual([
      "src/models.ts::Receipt", "src/service.ts::createOrder", "return",
    ]);
  });
});

describe("saveScan", () => {
  it("typescript 데이터만 교체하고 타 언어·실행 기록은 보존한다", () => {
    const dbPath = join(root, ".flowlens", "data.db");
    const db = openDb(dbPath);
    db.prepare(
      "INSERT OR REPLACE INTO functions (id, language, file_path, qualified_name) VALUES ('a.py::f', 'python', 'a.py', 'f')",
    ).run();
    db.prepare(
      "INSERT INTO call_edges VALUES ('x', 'y', 'runtime', 3)",
    ).run();
    saveScan(db, result);
    saveScan(db, result); // 재실행에도 중복 없음
    const tsCount = db.prepare(
      "SELECT COUNT(*) c FROM functions WHERE language='typescript'",
    ).get() as { c: number };
    expect(tsCount.c).toBe(result.functions.length);
    expect(db.prepare("SELECT COUNT(*) c FROM functions WHERE language='python'").get())
      .toEqual({ c: 1 });
    expect(db.prepare("SELECT count FROM call_edges WHERE kind='runtime'").get())
      .toEqual({ count: 3 });
    db.close();
  });
});

describe("findViolations", () => {
  it("주석 없는 함수를 잡는다", () => {
    const targets = findViolations(result).map((v) => v.target);
    expect(targets).toContain("src/service.ts::noDocs");
    expect(targets).not.toContain("src/service.ts::createOrder");
  });
});
