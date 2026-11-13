import { describe, expect, it } from "vitest";
import {
  lowestOffer,
  marketplaceProducts,
  marketplaceSellers,
} from "./marketplace-data";

describe("Stage 17.4 marketplace demo data", () => {
  it("uses unique stable product, slug and offer identities", () => {
    expect(marketplaceProducts.length).toBeGreaterThanOrEqual(24);
    expect(new Set(marketplaceProducts.map(({ id }) => id)).size).toBe(
      marketplaceProducts.length,
    );
    expect(new Set(marketplaceProducts.map(({ slug }) => slug)).size).toBe(
      marketplaceProducts.length,
    );
    const offers = marketplaceProducts.flatMap(({ offers }) => offers);
    expect(new Set(offers.map(({ id }) => id)).size).toBe(offers.length);
  });

  it("keeps every offer bounded to a known seller and integer UZS values", () => {
    const sellerIds = new Set(marketplaceSellers.map(({ id }) => id));
    for (const product of marketplaceProducts) {
      expect(product.offers.length).toBeGreaterThanOrEqual(2);
      for (const offer of product.offers) {
        expect(sellerIds.has(offer.sellerId)).toBe(true);
        expect(Number.isSafeInteger(offer.priceMinor)).toBe(true);
        expect(offer.priceMinor).toBeGreaterThan(0);
        expect(Number.isSafeInteger(offer.stock)).toBe(true);
        expect(offer.stock).toBeGreaterThanOrEqual(0);
      }
      expect(lowestOffer(product)).toBeDefined();
    }
  });

  it("ships complete RU, UZ and EN customer-facing catalog strings", () => {
    for (const product of marketplaceProducts) {
      for (const locale of ["ru", "uz", "en"] as const) {
        expect(product.name[locale].trim()).not.toBe("");
        expect(product.description[locale].trim()).not.toBe("");
      }
    }
  });
});
