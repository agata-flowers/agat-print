import { describe, expect, it } from "vitest";
import { calculateCustomerPrice } from "./pricing";

describe("server-authoritative customer pricing", () => {
  it("uses integer minor units for pages, quantity and bounded options", () => {
    const result = calculateCustomerPrice({
      basePriceMinor: 1_000n,
      perPagePriceMinor: 250n,
      optionPrices: { "COLOR=COLOR": "500" },
      pageCount: 2,
      quantity: 3,
      configuration: { COLOR: "COLOR" },
    });
    expect(result.totalMinor).toBe(4_000n);
    expect(result.lineItems).toHaveLength(3);
  });

  it("rejects non-integer tariff rules", () => {
    expect(() =>
      calculateCustomerPrice({
        basePriceMinor: 0n,
        perPagePriceMinor: 1n,
        optionPrices: { "COLOR=COLOR": 1.5 },
        pageCount: 1,
        quantity: 1,
        configuration: { COLOR: "COLOR" },
      }),
    ).toThrowError("INVALID_TARIFF_RULE");
  });
});
