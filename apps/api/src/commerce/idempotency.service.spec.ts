import { describe, expect, it } from "vitest";
import { canonicalJson } from "./idempotency.service";

describe("canonical JSON", () => {
  it("treats PostgreSQL jsonb key reordering as equivalent", () => {
    const calculated = [
      {
        code: "OPTION",
        option: "COLOR",
        value: "COLOR",
        quantity: 2,
        unitPriceMinor: "500",
        totalMinor: "1000",
      },
    ];
    const fromJsonb = [
      {
        code: "OPTION",
        value: "COLOR",
        option: "COLOR",
        quantity: 2,
        totalMinor: "1000",
        unitPriceMinor: "500",
      },
    ];

    expect(canonicalJson(calculated)).toBe(canonicalJson(fromJsonb));
  });
});
