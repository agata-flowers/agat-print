import { createHash } from "node:crypto";
import type { UploadFileKind } from "@prisma/client";

export type CatalogOptionField = {
  code: string;
  labelRu: string;
  labelUz: string;
  required: boolean;
  values: Array<{ code: string; labelRu: string; labelUz: string }>;
};

export type CatalogOptionSchema = { fields: CatalogOptionField[] };

const code = /^[A-Z][A-Z0-9_]{1,39}$/;
const valueCode = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const allowedKinds = new Set<UploadFileKind>(["PDF", "DOCX", "JPEG", "PNG"]);

export class CatalogPolicyError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
  }
}

export function validateCatalogItem(input: {
  serviceCode: string;
  acceptedFileKinds: unknown[];
  optionSchema: Record<string, unknown>;
}) {
  if (!code.test(input.serviceCode))
    throw new CatalogPolicyError("INVALID_SERVICE_CODE");
  if (
    input.acceptedFileKinds.length === 0 ||
    input.acceptedFileKinds.length > 4 ||
    input.acceptedFileKinds.some(
      (kind) =>
        typeof kind !== "string" || !allowedKinds.has(kind as UploadFileKind),
    )
  )
    throw new CatalogPolicyError("INVALID_FILE_KIND");
  const fields = input.optionSchema.fields;
  if (!Array.isArray(fields) || fields.length > 12)
    throw new CatalogPolicyError("INVALID_OPTION_SCHEMA");
  const seen = new Set<string>();
  const normalized: CatalogOptionField[] = fields.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new CatalogPolicyError("INVALID_OPTION_SCHEMA");
    const field = raw as Record<string, unknown>;
    if (
      typeof field.code !== "string" ||
      !code.test(field.code) ||
      seen.has(field.code) ||
      typeof field.labelRu !== "string" ||
      field.labelRu.length > 120 ||
      typeof field.labelUz !== "string" ||
      field.labelUz.length > 120 ||
      typeof field.required !== "boolean" ||
      !Array.isArray(field.values) ||
      field.values.length === 0 ||
      field.values.length > 30 ||
      field.values.some((value) => {
        if (!value || typeof value !== "object") return true;
        const candidate = value as Record<string, unknown>;
        return (
          typeof candidate.code !== "string" ||
          !valueCode.test(candidate.code) ||
          typeof candidate.labelRu !== "string" ||
          candidate.labelRu.length > 120 ||
          typeof candidate.labelUz !== "string" ||
          candidate.labelUz.length > 120
        );
      })
    )
      throw new CatalogPolicyError("INVALID_OPTION_SCHEMA");
    seen.add(field.code);
    return {
      code: field.code,
      labelRu: field.labelRu,
      labelUz: field.labelUz,
      required: field.required,
      values: (
        field.values as Array<{
          code: string;
          labelRu: string;
          labelUz: string;
        }>
      ).filter(
        (value, index, values) =>
          values.findIndex((item) => item.code === value.code) === index,
      ),
    };
  });
  return {
    acceptedFileKinds: [
      ...new Set(input.acceptedFileKinds),
    ] as UploadFileKind[],
    optionSchema: { fields: normalized } satisfies CatalogOptionSchema,
  };
}

export function validateConfiguration(
  schemaValue: unknown,
  configuration: Record<string, unknown>,
) {
  const schema = schemaValue as CatalogOptionSchema;
  if (!schema || !Array.isArray(schema.fields))
    throw new CatalogPolicyError("INVALID_OPTION_SCHEMA");
  const known = new Set(schema.fields.map((field) => field.code));
  if (Object.keys(configuration).some((key) => !known.has(key)))
    throw new CatalogPolicyError("INVALID_SERVICE_OPTIONS");
  for (const field of schema.fields) {
    const value = configuration[field.code];
    if (field.required && typeof value !== "string")
      throw new CatalogPolicyError("MISSING_SERVICE_OPTION");
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        !field.values.some((item) => item.code === value))
    )
      throw new CatalogPolicyError("INVALID_SERVICE_OPTIONS");
  }
  return Object.fromEntries(
    Object.entries(configuration).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export const configurationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const optionPriceKey = (codeValue: string, selected: string) =>
  `${codeValue}=${selected}`;
