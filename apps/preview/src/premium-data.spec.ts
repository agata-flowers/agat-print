import { describe, expect, it } from "vitest";
import { categories, createProductFeed, localized } from "./premium-data";

describe("premium demo catalog", () => {
  it("contains the eleven approved localized service and marketplace categories", () => {
    expect(categories).toHaveLength(11);
    for (const category of categories) {
      expect(localized(category.label, "ru")).toBeTruthy();
      expect(localized(category.label, "uz")).toBeTruthy();
      expect(localized(category.label, "en")).toBeTruthy();
    }
    expect(categories.slice(-5).map((category) => category.id)).toEqual([
      "stationery",
      "gifts",
      "accessories",
      "photo-gifts",
      "study-office",
    ]);
  });

  it("generates a varied feed with unique identities and integer UZS prices", () => {
    const feed = createProductFeed(180);
    expect(new Set(feed.map((product) => product.id)).size).toBe(feed.length);
    expect(
      new Set(feed.map((product) => localized(product.name, "ru"))).size,
    ).toBe(feed.length);
    expect(
      feed.every(
        (product) =>
          Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0,
      ),
    ).toBe(true);
  });
});
