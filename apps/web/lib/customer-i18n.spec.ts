import { describe, expect, it } from "vitest";
import { customerCopy, customerError, localeFrom } from "./customer-i18n";

describe("customer RU/UZ presentation", () => {
  it("uses Russian as a safe fallback and provides Uzbek primary copy", () => {
    expect(localeFrom("en")).toBe("ru");
    expect(customerCopy("uz").checkout).toBe("Buyurtmani rasmiylashtirish");
  });

  it("maps bounded domain errors without exposing internal details", () => {
    expect(customerError("QUOTE_STALE", "ru")).toContain("устарела");
    expect(customerError("UNKNOWN_INTERNAL_VALUE", "uz")).not.toContain(
      "UNKNOWN_INTERNAL_VALUE",
    );
  });
});
