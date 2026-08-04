// 개요: 직렬화기 테스트 — fail-open과 크기 상한을 검증한다.
import { describe, expect, it } from "vitest";

import { serializeArgs, serializeValue } from "../src/serialize.js";

describe("serializeValue", () => {
  it("기본형은 JSON 그대로", () => {
    expect(JSON.parse(serializeValue({ a: 1 }))).toEqual({ a: 1 });
    expect(JSON.parse(serializeValue("한글"))).toBe("한글");
    expect(JSON.parse(serializeValue(null))).toBeNull();
  });

  it("클래스 인스턴스는 __type__과 공개 필드로", () => {
    class Order { constructor(public orderId: string, private _secret = "x") {} }
    const out = JSON.parse(serializeValue(new Order("o-1")));
    expect(out.__type__).toBe("Order");
    expect(out.orderId).toBe("o-1");
    expect(out._secret).toBeUndefined();
  });

  it("순환 참조도 예외 없이 처리", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeValue(a)).not.toThrow();
    expect(serializeValue(a)).toContain("circular");
  });

  it("크기 상한 초과 시 잘리고 표식", () => {
    const out = serializeValue("x".repeat(100_000), 1000);
    expect(Buffer.byteLength(out)).toBeLessThan(1100);
    expect(out.endsWith("...(truncated)")).toBe(true);
  });
});

describe("serializeArgs", () => {
  it("인자별 개별 직렬화 — 하나가 커도 나머지 유지", () => {
    const out = JSON.parse(
      serializeArgs({ small: 1, big: "y".repeat(100_000) }, 1000),
    );
    expect(out.small).toBe(1);
    expect(String(out.big).endsWith("...(truncated)")).toBe(true);
  });
});
