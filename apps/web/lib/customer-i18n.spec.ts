import { describe, expect, it } from "vitest";
import { customerCopy, customerError, localeFrom } from "./customer-i18n";

describe("customer UZ/RU/EN presentation", () => {
  it("uses Russian as a safe fallback and supports all mandatory locales", () => {
    expect(localeFrom("en")).toBe("en");
    expect(localeFrom("unsupported")).toBe("ru");
    expect(customerCopy("uz").checkout).toBe("Buyurtmani rasmiylashtirish");
    expect(customerCopy("en").checkout).toBe("Place order");
  });

  it("maps bounded domain errors without exposing internal details", () => {
    expect(customerError("QUOTE_STALE", "ru")).toContain("устарела");
    expect(customerError("UNKNOWN_INTERNAL_VALUE", "uz")).not.toContain(
      "UNKNOWN_INTERNAL_VALUE",
    );
    expect(customerError("PAYMENT_RESULT_UNKNOWN", "en")).not.toContain(
      "PAYMENT_RESULT_UNKNOWN",
    );
  });
});
