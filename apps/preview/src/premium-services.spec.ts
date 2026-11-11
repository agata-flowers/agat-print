import { describe, expect, it } from "vitest";
import { premiumServices, serviceText, textFor } from "./premium-services";

describe("premium service presentation model", () => {
  it("defines six distinct service workflows with required configuration", () => {
    expect(premiumServices).toHaveLength(6);
    expect(new Set(premiumServices.map((service) => service.id)).size).toBe(6);
    for (const service of premiumServices) {
      expect(service.basePrice).toBeGreaterThan(0);
      expect(service.fields.some((field) => field.required)).toBe(true);
      expect(service.title.ru).toBeTruthy();
      expect(service.title.uz).toBeTruthy();
      expect(service.title.en).toBeTruthy();
    }
  });

  it("ships complete service workflow copy in exactly uz, ru and en", () => {
    expect(Object.keys(serviceText).sort()).toEqual(["en", "ru", "uz"]);
    const referenceKeys = Object.keys(serviceText.ru).sort();
    expect(Object.keys(serviceText.uz).sort()).toEqual(referenceKeys);
    expect(Object.keys(serviceText.en).sort()).toEqual(referenceKeys);
    expect(textFor(premiumServices[0]!.title, "en")).toBe("ID photos");
  });
});
