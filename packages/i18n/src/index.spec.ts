import { describe, expect, it } from "vitest";
import {
  getPreviewCopy,
  localeFrom,
  previewCopy,
  SUPPORTED_LOCALES,
} from "./index.js";

describe("shared AGAT presentation locales", () => {
  it("supports exactly Uzbek, Russian, and English", () => {
    expect(SUPPORTED_LOCALES).toEqual(["uz", "ru", "en"]);
    expect(localeFrom("uz")).toBe("uz");
    expect(localeFrom("ru")).toBe("ru");
    expect(localeFrom("en")).toBe("en");
    expect(localeFrom("de")).toBe("ru");
  });

  it("keeps every preview locale complete and nonempty", () => {
    const reference = Object.keys(previewCopy.ru).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(previewCopy[locale]).sort()).toEqual(reference);
      expect(Object.values(previewCopy[locale]).every(Boolean)).toBe(true);
    }
  });

  it("never exposes backend state names in primary status copy", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getPreviewCopy(locale).orderStatus).not.toMatch(
        /IN_PRODUCTION|PARTNER_ACCEPTED|AWAITING_PAYMENT/,
      );
    }
  });
});
