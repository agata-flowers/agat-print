import { describe, expect, it } from "vitest";
import {
  CatalogPolicyError,
  configurationHash,
  validateCatalogItem,
  validateConfiguration,
} from "./catalog-policy";

const schema = {
  fields: [
    {
      code: "PAPER",
      labelRu: "Бумага",
      labelUz: "Qog‘oz",
      required: true,
      values: [{ code: "STANDARD", labelRu: "Обычная", labelUz: "Oddiy" }],
    },
  ],
};

describe("customer catalog policy", () => {
  it("validates extensible catalog entries and canonical configuration", () => {
    const item = validateCatalogItem({
      serviceCode: "DOCUMENT_PRINT",
      acceptedFileKinds: ["PDF", "DOCX"],
      optionSchema: schema,
    });
    expect(item.acceptedFileKinds).toEqual(["PDF", "DOCX"]);
    expect(
      validateConfiguration(item.optionSchema, { PAPER: "STANDARD" }),
    ).toEqual({ PAPER: "STANDARD" });
  });

  it("rejects unknown options and unsupported formats", () => {
    expect(() =>
      validateConfiguration(schema, { INTERNAL: "VALUE" }),
    ).toThrowError(CatalogPolicyError);
    expect(() =>
      validateCatalogItem({
        serviceCode: "COPY",
        acceptedFileKinds: ["EXE"],
        optionSchema: schema,
      }),
    ).toThrowError("INVALID_FILE_KIND");
  });

  it("hashes equivalent canonical configuration deterministically", () => {
    expect(
      configurationHash(validateConfiguration(schema, { PAPER: "STANDARD" })),
    ).toBe(configurationHash({ PAPER: "STANDARD" }));
  });
});
