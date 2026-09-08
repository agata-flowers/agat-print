import type { Prisma } from "@prisma/client";
import { CatalogPolicyError, optionPriceKey } from "./catalog-policy";

type PricingInput = {
  basePriceMinor: bigint;
  perPagePriceMinor: bigint;
  optionPrices: Prisma.JsonValue;
  pageCount: number;
  quantity: number;
  configuration: Record<string, unknown>;
};

export function calculateCustomerPrice(input: PricingInput) {
  const optionPrices =
    input.optionPrices &&
    typeof input.optionPrices === "object" &&
    !Array.isArray(input.optionPrices)
      ? (input.optionPrices as Record<string, unknown>)
      : {};
  const pageUnits = BigInt(input.pageCount * input.quantity);
  const lineItems: Array<Record<string, string | number>> = [];
  if (input.basePriceMinor > 0n)
    lineItems.push({
      code: "BASE",
      quantity: 1,
      unitPriceMinor: input.basePriceMinor.toString(),
      totalMinor: input.basePriceMinor.toString(),
    });
  const pageTotal = input.perPagePriceMinor * pageUnits;
  if (pageTotal > 0n)
    lineItems.push({
      code: "PAGE",
      quantity: pageUnits.toString(),
      unitPriceMinor: input.perPagePriceMinor.toString(),
      totalMinor: pageTotal.toString(),
    });
  let optionTotal = 0n;
  for (const [field, selected] of Object.entries(input.configuration).sort()) {
    if (typeof selected !== "string") continue;
    const raw = optionPrices[optionPriceKey(field, selected)];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw))
      throw new CatalogPolicyError("INVALID_TARIFF_RULE");
    const unit = BigInt(raw);
    const total = unit * BigInt(input.quantity);
    optionTotal += total;
    lineItems.push({
      code: "OPTION",
      option: field,
      value: selected,
      quantity: input.quantity,
      unitPriceMinor: unit.toString(),
      totalMinor: total.toString(),
    });
  }
  const subtotalMinor = input.basePriceMinor + pageTotal + optionTotal;
  if (subtotalMinor <= 0n) throw new CatalogPolicyError("EMPTY_TARIFF");
  return {
    lineItems,
    subtotalMinor,
    discountMinor: 0n,
    totalMinor: subtotalMinor,
  };
}
