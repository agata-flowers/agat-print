import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import {
  IdempotencyService,
  canonicalJson,
} from "../commerce/idempotency.service";
import { FulfillmentCrypto } from "../fulfillment/fulfillment.crypto";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AddBasketItemDto,
  BasketFulfillmentPreferenceDto,
  BasketStudioPreferenceDto,
  BasketVersionDto,
  CreateBasketDto,
  ReorderBasketItemDto,
} from "./dto";
import { calculateCustomerPrice } from "./pricing";

const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const basketInclude = {
  items: {
    where: { removedAt: null },
    orderBy: { sequence: "asc" as const },
    include: {
      draft: {
        include: {
          catalogItem: true,
          catalogVersion: true,
          layout: { include: { printReadyVersions: true, upload: true } },
        },
      },
    },
  },
  quotes: {
    orderBy: { sequence: "desc" as const },
    take: 1,
    include: { items: { orderBy: { sequence: "asc" as const } } },
  },
  studioPreference: true,
  fulfillmentPreference: true,
  order: { select: { id: true, status: true } },
} satisfies Prisma.OrderBasketInclude;

type BasketRow = Prisma.OrderBasketGetPayload<{
  include: typeof basketInclude;
}>;

@Injectable()
export class BasketService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(FulfillmentCrypto) private readonly crypto: FulfillmentCrypto,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    key: string | undefined,
    input: CreateBasketDto,
  ) {
    const prepared = this.idempotency.prepare(
      `basket:create:${userId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const response = await this.serializable(async (tx) => {
      // There is no basket row to lock yet. Serialize creation by the hashed
      // idempotency identity, then re-check inside the transaction so two
      // concurrent requests cannot create two baskets.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${prepared.scope + ":" + prepared.keyDigest}, 0))`;
      const insideReplay = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (insideReplay)
        return this.idempotency.assertCompatible(
          insideReplay,
          prepared,
        ) as Record<string, unknown>;
      const created = await tx.orderBasket.create({
        data: {
          userId,
          locale: input.locale,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
        include: basketInclude,
      });
      const value = this.view(created);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          value as Prisma.InputJsonValue,
          201,
        ),
      });
      return value;
    });
    await this.audit.record("ORDER_BASKET_CREATED", userId, "order-basket", {
      status: "ACTIVE",
      operation: "CREATE",
    });
    return response;
  }

  async list(userId: string) {
    const baskets = await this.prisma.orderBasket.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 25,
      include: basketInclude,
    });
    return { baskets: baskets.map((basket) => this.view(basket)) };
  }

  async get(userId: string, basketId: string) {
    return this.view(await this.owned(userId, basketId));
  }

  async addItem(
    userId: string,
    basketId: string,
    key: string | undefined,
    input: AddBasketItemDto,
  ) {
    return this.mutate(
      userId,
      basketId,
      key,
      "add",
      input,
      async (tx, basket) => {
        if (basket.items.length >= 10)
          throw new ConflictException({ code: "BASKET_ITEM_LIMIT" });
        const draft = await tx.orderDraft.findFirst({
          where: { id: input.draftId, userId, checkedOutAt: null },
        });
        if (!draft) throw new NotFoundException();
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"basket-draft:" + input.draftId}, 0))`;
        const activeMembership = await tx.orderBasketItem.findFirst({
          where: {
            draftId: input.draftId,
            removedAt: null,
            basket: { status: { in: ["ACTIVE", "QUOTED"] } },
          },
          select: { id: true, basketId: true },
        });
        if (activeMembership)
          throw new ConflictException({ code: "ITEM_ALREADY_IN_BASKET" });
        if (
          !draft.layoutApprovalId ||
          !["READY_FOR_QUOTE", "QUOTED"].includes(draft.status)
        )
          throw new ConflictException({ code: "ITEM_NOT_READY" });
        await tx.orderBasketItem.create({
          data: {
            basketId,
            draftId: draft.id,
            sequence: basket.items.length + 1,
          },
        });
      },
    );
  }

  async removeItem(
    userId: string,
    basketId: string,
    itemId: string,
    key: string | undefined,
    input: BasketVersionDto,
  ) {
    return this.mutate(
      userId,
      basketId,
      key,
      `remove:${itemId}`,
      input,
      async (tx, basket) => {
        const item = basket.items.find((candidate) => candidate.id === itemId);
        if (!item) throw new NotFoundException();
        await tx.orderBasketItem.update({
          where: { id: item.id },
          data: { removedAt: new Date() },
        });
        const remaining = basket.items.filter(
          (candidate) => candidate.id !== item.id,
        );
        for (const [index, row] of remaining.entries())
          await tx.orderBasketItem.update({
            where: { id: row.id },
            data: { sequence: index + 1 },
          });
      },
    );
  }

  async reorderItem(
    userId: string,
    basketId: string,
    itemId: string,
    key: string | undefined,
    input: ReorderBasketItemDto,
  ) {
    return this.mutate(
      userId,
      basketId,
      key,
      `reorder:${itemId}`,
      input,
      async (tx, basket) => {
        const current = basket.items.find(
          (candidate) => candidate.id === itemId,
        );
        if (!current) throw new NotFoundException();
        if (input.sequence > basket.items.length)
          throw new ConflictException({ code: "INVALID_ITEM_SEQUENCE" });
        const reordered = basket.items.filter(
          (candidate) => candidate.id !== itemId,
        );
        reordered.splice(input.sequence - 1, 0, current);
        // Temporary negative positions avoid the unique (basket, sequence) key.
        for (const [index, row] of reordered.entries())
          await tx.orderBasketItem.update({
            where: { id: row.id },
            data: { sequence: -(index + 1) },
          });
        for (const [index, row] of reordered.entries())
          await tx.orderBasketItem.update({
            where: { id: row.id },
            data: { sequence: index + 1 },
          });
      },
    );
  }

  async setStudio(
    userId: string,
    basketId: string,
    key: string | undefined,
    input: BasketStudioPreferenceDto,
  ) {
    return this.mutate(userId, basketId, key, "studio", input, async (tx) => {
      if (input.mode === "PREFERRED_STUDIO" && !input.studioSlug)
        throw new ConflictException({ code: "STUDIO_REQUIRED" });
      const listing = input.studioSlug
        ? await tx.studioListingVersion.findFirst({
            where: {
              publicSlug: input.studioSlug,
              status: "PUBLISHED",
              branch: { active: true, acceptingOrders: true },
            },
            select: { branchId: true },
          })
        : null;
      if (input.studioSlug && !listing) throw new NotFoundException();
      await tx.orderBasketStudioPreference.upsert({
        where: { basketId },
        create: {
          basketId,
          mode: input.mode,
          fallbackPolicy: input.fallbackPolicy,
          branchId:
            input.mode === "PREFERRED_STUDIO" ? listing!.branchId : null,
        },
        update: {
          mode: input.mode,
          fallbackPolicy: input.fallbackPolicy,
          branchId:
            input.mode === "PREFERRED_STUDIO" ? listing!.branchId : null,
          invalidatedAt: null,
          version: { increment: 1 },
        },
      });
    });
  }

  async setFulfillment(
    userId: string,
    basketId: string,
    key: string | undefined,
    input: BasketFulfillmentPreferenceDto,
  ) {
    return this.mutate(
      userId,
      basketId,
      key,
      "fulfillment",
      input,
      async (tx) => {
        const pickup = input.mode === "PICKUP";
        if (
          pickup !== (input.locationCode === "PICKUP") ||
          (!pickup && !input.address?.trim())
        )
          throw new ConflictException({
            code: "INVALID_FULFILLMENT_SELECTION",
          });
        const encrypted = pickup
          ? {
              addressCiphertext: null,
              addressIv: null,
              addressAuthTag: null,
              addressKeyVersion: 1,
            }
          : this.crypto.encryptAddress(input.address!.trim());
        await tx.orderBasketFulfillmentPreference.upsert({
          where: { basketId },
          create: {
            basketId,
            mode: input.mode,
            locationCode: input.locationCode,
            ...encrypted,
          },
          update: {
            mode: input.mode,
            locationCode: input.locationCode,
            ...encrypted,
            invalidatedAt: null,
            version: { increment: 1 },
          },
        });
      },
    );
  }

  async quote(
    userId: string,
    basketId: string,
    key: string | undefined,
    input: BasketVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `basket:quote:${userId}:${basketId}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrderBasket" WHERE id = ${basketId}::uuid FOR UPDATE`;
      const insideReplay = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (insideReplay)
        return this.idempotency.assertCompatible(
          insideReplay,
          prepared,
        ) as Record<string, unknown>;
      const basket = await tx.orderBasket.findFirst({
        where: { id: basketId, userId },
        include: basketInclude,
      });
      this.assertMutable(basket, input.version);
      if (!basket || basket.items.length < 1 || basket.items.length > 10)
        throw new ConflictException({ code: "BASKET_ITEM_COUNT" });
      const tariff = await tx.tariffVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        include: { rules: true, fulfillmentRules: true },
      });
      if (!tariff) throw new ConflictException({ code: "NO_ACTIVE_TARIFF" });
      const preference = basket.fulfillmentPreference;
      if (!preference || preference.invalidatedAt)
        throw new ConflictException({
          code: "FULFILLMENT_SELECTION_REQUIRED",
        });
      const fulfillmentRule = tariff.fulfillmentRules.find(
        (rule) =>
          rule.enabled &&
          rule.mode === preference.mode &&
          rule.locationCode === preference.locationCode,
      );
      if (!fulfillmentRule)
        throw new ConflictException({ code: "FULFILLMENT_UNAVAILABLE" });
      const studioMode = basket.studioPreference?.mode ?? "AUTO_ASSIGN";
      const studioFallbackPolicy =
        basket.studioPreference?.fallbackPolicy ?? "ALLOW_ELIGIBLE_ALTERNATIVE";
      const studio = basket.studioPreference?.branchId
        ? await tx.branch.findFirst({
            where: {
              id: basket.studioPreference.branchId,
              active: true,
              acceptingOrders: true,
              partner: { status: { in: ["APPROVED", "ACTIVE"] } },
            },
            include: {
              studioListings: {
                where: { status: "PUBLISHED" },
                orderBy: { sequence: "desc" },
                take: 1,
              },
              capabilityVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              operationalVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              catalogVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              capacityVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
            },
          })
        : null;
      if (
        studioMode === "PREFERRED_STUDIO" &&
        (!studio ||
          !studio.studioListings[0] ||
          !studio.capabilityVersions[0] ||
          !studio.operationalVersions[0] ||
          !studio.catalogVersions[0] ||
          !studio.capacityVersions[0])
      )
        throw new ConflictException({ code: "STUDIO_PREFERENCE_STALE" });
      const itemData = basket.items.map((item) => {
        const draft = item.draft;
        if (draft.catalogVersion.status !== "ACTIVE")
          throw new ConflictException({ code: "CATALOG_CHANGED" });
        const layout = draft.layout;
        const ready = layout?.printReadyVersions.find(
          (row) => row.id === layout.latestPrintReadyId,
        );
        if (
          !layout ||
          layout.status !== "APPROVED" ||
          layout.currentApprovalId !== draft.layoutApprovalId ||
          !ready
        )
          throw new ConflictException({
            code: "LAYOUT_APPROVAL_NOT_CURRENT",
          });
        const rule = tariff.rules.find(
          (row) => row.serviceCode === draft.serviceCode,
        );
        const price = calculateCustomerPrice({
          basePriceMinor: rule?.basePriceMinor ?? tariff.basePriceMinor,
          perPagePriceMinor:
            rule?.perPagePriceMinor ?? tariff.perPagePriceMinor,
          optionPrices: rule?.optionPrices ?? {},
          pageCount: ready.pageCount,
          quantity: draft.quantity,
          configuration: draft.configuration as Record<string, unknown>,
        });
        return { item, draft, layout, ready, price };
      });
      const itemSubtotal = itemData.reduce(
        (sum, row) => sum + row.price.totalMinor,
        0n,
      );
      const total = itemSubtotal + fulfillmentRule.feeMinor;
      await tx.basketQuote.updateMany({
        where: { basketId, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      const nextVersion = basket.version + 1;
      const quote = await tx.basketQuote.create({
        data: {
          basketId,
          sequence: (basket.quotes[0]?.sequence ?? 0) + 1,
          basketVersion: nextVersion,
          tariffVersionId: tariff.id,
          tariffVersion: tariff.version,
          fulfillmentFeeMinor: fulfillmentRule.feeMinor,
          subtotalMinor: total,
          totalMinor: total,
          membershipHash: digest(
            itemData.map(({ item, draft }) => [
              item.sequence,
              draft.id,
              draft.version,
            ]),
          ),
          fulfillmentRuleId: fulfillmentRule.id,
          studioMode,
          studioFallbackPolicy,
          studioBranchId: studio?.id,
          studioListingId: studio?.studioListings[0]?.id,
          studioCapabilityId: studio?.capabilityVersions[0]?.id,
          studioOperationalId: studio?.operationalVersions[0]?.id,
          studioCatalogId: studio?.catalogVersions[0]?.id,
          studioCapacityId: studio?.capacityVersions[0]?.id,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          items: {
            create: itemData.map(({ item, draft, layout, ready, price }) => ({
              basketItemId: item.id,
              sequence: item.sequence,
              catalogItemId: draft.catalogItemId,
              draftVersion: draft.version,
              layoutVersion: layout.version,
              layoutApprovalId: draft.layoutApprovalId!,
              printReadyVersionId: ready.id,
              configurationHash: digest(draft.configuration),
              sourceParameters: {
                serviceCode: draft.serviceCode,
                configuration: draft.configuration,
                fileKind: layout.upload.fileKind,
                pageCount: ready.pageCount,
              },
              lineItems: price.lineItems,
              quantity: draft.quantity,
              subtotalMinor: price.subtotalMinor,
              discountMinor: price.discountMinor,
              totalMinor: price.totalMinor,
            })),
          },
        },
      });
      await tx.orderBasket.update({
        where: { id: basketId },
        data: { status: "QUOTED", version: nextVersion },
      });
      const value = {
        id: quote.id,
        basketVersion: nextVersion,
        totalMinor: total.toString(),
        currency: "UZS",
        expiresAt: quote.expiresAt,
      };
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          value as Prisma.InputJsonValue,
          201,
        ),
      });
      return value;
    });
  }

  async checkout(
    userId: string,
    basketId: string,
    key: string | undefined,
    input: BasketVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `basket:checkout:${userId}:${basketId}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrderBasket" WHERE id = ${basketId}::uuid FOR UPDATE`;
      const insideReplay = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (insideReplay)
        return this.idempotency.assertCompatible(
          insideReplay,
          prepared,
        ) as Record<string, unknown>;
      const basket = await tx.orderBasket.findFirst({
        where: { id: basketId, userId },
        include: basketInclude,
      });
      this.assertMutable(basket, input.version, "QUOTED");
      const quote = basket?.quotes[0];
      if (
        !basket ||
        !quote ||
        quote.status !== "ACTIVE" ||
        quote.expiresAt <= new Date() ||
        quote.basketVersion !== basket.version
      )
        throw new ConflictException({ code: "QUOTE_STALE" });
      if (quote.items.length !== basket.items.length)
        throw new ConflictException({ code: "QUOTE_STALE" });
      for (const [index, item] of basket.items.entries()) {
        const frozen = quote.items[index]!;
        if (
          item.id !== frozen.basketItemId ||
          item.draft.version !== frozen.draftVersion ||
          item.draft.layoutApprovalId !== frozen.layoutApprovalId ||
          item.draft.layout?.latestPrintReadyId !== frozen.printReadyVersionId
        )
          throw new ConflictException({ code: "QUOTE_STALE" });
      }
      const activeTariff = await tx.tariffVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if (
        activeTariff?.id !== quote.tariffVersionId ||
        basket.items.some(
          (item) => item.draft.catalogVersion.status !== "ACTIVE",
        )
      )
        throw new ConflictException({ code: "QUOTE_STALE" });
      const studio = quote.studioBranchId
        ? await tx.branch.findFirst({
            where: {
              id: quote.studioBranchId,
              active: true,
              acceptingOrders: true,
              partner: { status: { in: ["APPROVED", "ACTIVE"] } },
            },
            include: {
              studioListings: {
                where: { status: "PUBLISHED" },
                orderBy: { sequence: "desc" },
                take: 1,
              },
              capabilityVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              operationalVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              catalogVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
              capacityVersions: {
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                take: 1,
              },
            },
          })
        : null;
      if (
        quote.studioMode === "PREFERRED_STUDIO" &&
        (!studio ||
          studio.studioListings[0]?.id !== quote.studioListingId ||
          studio.capabilityVersions[0]?.id !== quote.studioCapabilityId ||
          studio.operationalVersions[0]?.id !== quote.studioOperationalId ||
          studio.catalogVersions[0]?.id !== quote.studioCatalogId ||
          studio.capacityVersions[0]?.id !== quote.studioCapacityId)
      )
        throw new ConflictException({ code: "STUDIO_PREFERENCE_STALE" });
      const primary = basket.items[0]!;
      const fulfillment = basket.fulfillmentPreference!;
      const fulfillmentRule = await tx.fulfillmentTariffRule.findUniqueOrThrow({
        where: { id: quote.fulfillmentRuleId! },
      });
      if (!fulfillmentRule.enabled)
        throw new ConflictException({ code: "FULFILLMENT_UNAVAILABLE" });
      const order = await tx.order.create({
        data: {
          userId,
          layoutId: primary.draft.layoutId!,
          layoutApprovalId: primary.draft.layoutApprovalId!,
          printReadyVersionId: primary.draft.layout!.latestPrintReadyId!,
          basketId,
          basketQuoteId: quote.id,
          priceSnapshot: {
            create: {
              tariffVersionId: quote.tariffVersionId,
              tariffVersion: quote.tariffVersion,
              sourceParameters: {
                basketVersion: basket.version,
                membershipHash: quote.membershipHash,
              },
              lineItems: [
                ...quote.items.map((item) => ({
                  code: "ORDER_ITEM",
                  sequence: item.sequence,
                  totalMinor: item.totalMinor.toString(),
                })),
                {
                  code: "FULFILLMENT",
                  totalMinor: quote.fulfillmentFeeMinor.toString(),
                },
              ],
              quantity: quote.items.reduce(
                (sum, item) => sum + item.quantity,
                0,
              ),
              subtotalMinor: quote.subtotalMinor,
              discountMinor: quote.discountMinor,
              totalMinor: quote.totalMinor,
              currency: quote.currency,
            },
          },
          items: {
            create: basket.items.map((item, index) => {
              const frozen = quote.items[index]!;
              return {
                sequence: item.sequence,
                sourceDraftId: item.draft.id,
                catalogItemId: item.draft.catalogItemId,
                serviceCode: item.draft.serviceCode,
                configuration: item.draft
                  .configuration as Prisma.InputJsonValue,
                configurationHash: frozen.configurationHash,
                quantity: item.draft.quantity,
                layoutId: item.draft.layoutId!,
                layoutApprovalId: frozen.layoutApprovalId,
                printReadyVersionId: frozen.printReadyVersionId,
                subtotalMinor: frozen.subtotalMinor,
                discountMinor: frozen.discountMinor,
                totalMinor: frozen.totalMinor,
                currency: frozen.currency,
              };
            }),
          },
          fulfillmentSelection: {
            create: {
              mode: fulfillment.mode,
              locationCode: fulfillment.locationCode,
              addressCiphertext: fulfillment.addressCiphertext,
              addressIv: fulfillment.addressIv,
              addressAuthTag: fulfillment.addressAuthTag,
              addressKeyVersion: fulfillment.addressKeyVersion,
              sourcePreferenceVersion: fulfillment.version,
              feeMinor: fulfillmentRule.feeMinor,
              currency: "UZS",
              fulfillmentTariffRuleId: fulfillmentRule.id,
            },
          },
          studioSelection: {
            create:
              quote.studioMode === "PREFERRED_STUDIO"
                ? {
                    mode: "PREFERRED_STUDIO",
                    fallbackPolicy: quote.studioFallbackPolicy,
                    listingSequence: studio!.studioListings[0]!.sequence,
                    listingId: quote.studioListingId,
                    branchId: quote.studioBranchId,
                    capabilityVersionId: quote.studioCapabilityId,
                    operationalVersionId: quote.studioOperationalId,
                    catalogVersionId: quote.studioCatalogId,
                    capacityVersionId: quote.studioCapacityId,
                  }
                : {
                    mode: "AUTO_ASSIGN",
                    fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
                  },
          },
        },
      });
      await tx.orderDraft.updateMany({
        where: { id: { in: basket.items.map((item) => item.draft.id) } },
        data: {
          status: "CHECKED_OUT",
          checkedOutAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.basketQuote.update({
        where: { id: quote.id },
        data: { status: "CONSUMED", consumedAt: new Date() },
      });
      await tx.orderBasket.update({
        where: { id: basketId },
        data: {
          status: "CHECKED_OUT",
          checkedOutAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "order",
          aggregateId: order.id,
          aggregateVersion: order.version,
          eventType: "ORDER_CREATED",
          dedupKey: digest(["order", order.id, order.version, "ORDER_CREATED"]),
          payload: { aggregateId: order.id, aggregateVersion: order.version },
        },
      });
      const value = {
        id: order.id,
        status: order.status,
        totalMinor: quote.totalMinor.toString(),
        currency: quote.currency,
        itemCount: quote.items.length,
      };
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          value as Prisma.InputJsonValue,
          201,
        ),
      });
      return value;
    });
  }

  private async owned(userId: string, basketId: string) {
    const basket = await this.prisma.orderBasket.findFirst({
      where: { id: basketId, userId },
      include: basketInclude,
    });
    if (!basket) throw new NotFoundException();
    return basket;
  }

  private assertMutable(
    basket: BasketRow | null,
    version: number,
    status: "QUOTED" | "ACTIVE" = "ACTIVE",
  ) {
    if (!basket) throw new NotFoundException();
    if (basket.version !== version)
      throw new ConflictException({ code: "BASKET_VERSION_CONFLICT" });
    if (basket.status !== status || basket.expiresAt <= new Date())
      throw new ConflictException({ code: "BASKET_NOT_MUTABLE" });
  }

  private async mutate<T extends { version: number }>(
    userId: string,
    basketId: string,
    key: string | undefined,
    operation: string,
    input: T,
    action: (tx: Prisma.TransactionClient, basket: BasketRow) => Promise<void>,
  ) {
    const prepared = this.idempotency.prepare(
      `basket:${operation}:${userId}:${basketId}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrderBasket" WHERE id = ${basketId}::uuid FOR UPDATE`;
      const insideReplay = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (insideReplay)
        return this.idempotency.assertCompatible(
          insideReplay,
          prepared,
        ) as Record<string, unknown>;
      const basket = await tx.orderBasket.findFirst({
        where: { id: basketId, userId },
        include: basketInclude,
      });
      this.assertMutable(basket, input.version);
      await action(tx, basket!);
      await tx.basketQuote.updateMany({
        where: { basketId, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      await tx.orderBasket.update({
        where: { id: basketId },
        data: { status: "ACTIVE", version: { increment: 1 } },
      });
      const updated = await tx.orderBasket.findUniqueOrThrow({
        where: { id: basketId },
        include: basketInclude,
      });
      const value = this.view(updated);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(prepared, value as Prisma.InputJsonValue),
      });
      return value;
    });
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const known =
          error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
        const retryable =
          known?.code === "P2034" ||
          (known?.code === "P2010" &&
            typeof known.meta === "object" &&
            known.meta !== null &&
            "code" in known.meta &&
            known.meta.code === "40001");
        if (!retryable || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
    throw new ConflictException({ code: "CONCURRENT_CHANGE" });
  }

  private view(basket: BasketRow) {
    const quote = basket.quotes[0];
    return {
      id: basket.id,
      presentation:
        basket.status === "ACTIVE"
          ? "building"
          : basket.status === "QUOTED"
            ? "review"
            : basket.status === "CHECKED_OUT"
              ? "order"
              : "closed",
      locale: basket.locale,
      version: basket.version,
      expiresAt: basket.expiresAt,
      itemCount: basket.items.length,
      items: basket.items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        draftId: item.draft.id,
        serviceCode: item.draft.serviceCode,
        quantity: item.draft.quantity,
        ready: Boolean(item.draft.layoutApprovalId),
        title:
          basket.locale === "uz"
            ? item.draft.catalogItem.titleUz
            : basket.locale === "en"
              ? item.draft.catalogItem.titleEn
              : item.draft.catalogItem.titleRu,
      })),
      quote:
        quote && quote.status === "ACTIVE"
          ? {
              totalMinor: quote.totalMinor.toString(),
              currency: quote.currency,
              expiresAt: quote.expiresAt,
            }
          : null,
      order: basket.order,
    };
  }
}
