import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PaymentStatus } from "@prisma/client";
import type { PaymentProvider } from "@agat/providers";
import { AuditService } from "../audit/audit.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { PAYMENT_PROVIDER } from "../providers/provider-tokens";
import type {
  CreateOrderDto,
  CreateTariffDto,
  NoExecutorRefundDto,
  PaymentCallbackDto,
  StartPaymentDto,
} from "./dto";
import { canonicalJson, IdempotencyService } from "./idempotency.service";
import { MockPaymentProvider } from "./mock-payment.provider";
import { calculateCustomerPrice } from "../ordering/pricing";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const outbox = (
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  eventType: string,
): Prisma.OutboxEventCreateInput => ({
  aggregateType,
  aggregateId,
  aggregateVersion,
  eventType,
  dedupKey: digest(
    `${aggregateType}:${aggregateId}:${aggregateVersion}:${eventType}`,
  ),
  payload: { aggregateId, aggregateVersion },
});

const tariffView = (tariff: {
  id: string;
  version: number;
  status: string;
  currency: string;
  basePriceMinor: bigint;
  perPagePriceMinor: bigint;
  createdAt: Date;
  fulfillmentRules?: Array<{
    mode: string;
    locationCode: string;
    feeMinor: bigint;
    enabled: boolean;
  }>;
}) => ({
  id: tariff.id,
  version: tariff.version,
  status: tariff.status,
  currency: tariff.currency,
  basePriceMinor: tariff.basePriceMinor.toString(),
  perPagePriceMinor: tariff.perPagePriceMinor.toString(),
  createdAt: tariff.createdAt,
  fulfillmentRules: tariff.fulfillmentRules?.map((rule) => ({
    mode: rule.mode,
    locationCode: rule.locationCode,
    feeMinor: rule.feeMinor.toString(),
    enabled: rule.enabled,
  })),
});

const orderInclude = {
  priceSnapshot: true,
  payment: {
    include: { refunds: { orderBy: { createdAt: "desc" as const } } },
  },
  productionCycles: { orderBy: { sequence: "desc" as const }, take: 1 },
  fulfillments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  deliveryTasks: { orderBy: { assignedAt: "desc" as const }, take: 1 },
  fiscalOperations: {
    orderBy: { createdAt: "desc" as const },
    select: { type: true, status: true, amountMinor: true, currency: true },
  },
  studioSelection: {
    include: {
      listing: { select: { publicSlug: true, titleRu: true, titleUz: true } },
    },
  },
  fulfillmentSelection: {
    select: {
      mode: true,
      locationCode: true,
      feeMinor: true,
      currency: true,
    },
  },
} satisfies Prisma.OrderInclude;

type OrderWithFinance = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

const orderView = (order: OrderWithFinance) => ({
  id: order.id,
  layoutId: order.layoutId,
  layoutApprovalId: order.layoutApprovalId,
  printReadyVersionId: order.printReadyVersionId,
  status: order.status,
  version: order.version,
  createdAt: order.createdAt,
  studioPreference: order.studioSelection
    ? {
        mode: order.studioSelection.mode,
        fallbackPolicy: order.studioSelection.fallbackPolicy,
        studio: order.studioSelection.listing
          ? {
              slug: order.studioSelection.listing.publicSlug,
              titleRu: order.studioSelection.listing.titleRu,
              titleUz: order.studioSelection.listing.titleUz,
            }
          : null,
      }
    : null,
  fulfillmentSelection: order.fulfillmentSelection
    ? {
        mode: order.fulfillmentSelection.mode,
        locationCode: order.fulfillmentSelection.locationCode,
        feeMinor: order.fulfillmentSelection.feeMinor.toString(),
        currency: order.fulfillmentSelection.currency,
      }
    : null,
  price: order.priceSnapshot
    ? {
        tariffVersion: order.priceSnapshot.tariffVersion,
        sourceParameters: order.priceSnapshot.sourceParameters,
        lineItems: order.priceSnapshot.lineItems,
        quantity: order.priceSnapshot.quantity,
        subtotalMinor: order.priceSnapshot.subtotalMinor.toString(),
        discountMinor: order.priceSnapshot.discountMinor.toString(),
        totalMinor: order.priceSnapshot.totalMinor.toString(),
        currency: order.priceSnapshot.currency,
      }
    : null,
  payment: order.payment
    ? {
        status: order.payment.status,
        amountMinor: order.payment.amountMinor.toString(),
        currency: order.payment.currency,
        refundStatus: order.payment.refunds[0]?.status ?? null,
      }
    : null,
  fiscal: order.fiscalOperations.map((operation) => ({
    type: operation.type,
    status: operation.status,
    amountMinor: operation.amountMinor.toString(),
    currency: operation.currency,
  })),
  fulfillment:
    order.fulfillments[0] &&
    order.fulfillments[0].productionCycleId === order.productionCycles[0]?.id
      ? {
          mode: order.fulfillments[0].mode,
          status: order.fulfillments[0].status,
          expiresAt: order.fulfillments[0].completionExpiresAt,
          deliveryStatus: order.deliveryTasks[0]?.status ?? null,
        }
      : null,
});

@Injectable()
export class CommerceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(MockPaymentProvider)
    private readonly mockPayments: MockPaymentProvider,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async createTariff(actorId: string, input: CreateTariffDto) {
    const base = BigInt(input.basePriceMinor);
    const perPage = BigInt(input.perPagePriceMinor);
    if (base + perPage <= 0n)
      throw new ConflictException({ code: "EMPTY_TARIFF" });
    const rules = (input.rules ?? []).map((rule) => {
      if (
        !/^[A-Z][A-Z0-9_]{2,39}$/.test(rule.serviceCode) ||
        !/^\d{1,15}$/.test(rule.basePriceMinor) ||
        !/^\d{1,15}$/.test(rule.perPagePriceMinor) ||
        !rule.optionPrices ||
        Object.entries(rule.optionPrices).some(
          ([key, value]) =>
            !/^[A-Z][A-Z0-9_]{1,39}=[A-Z0-9][A-Z0-9_]{0,39}$/.test(key) ||
            !/^\d{1,15}$/.test(value),
        )
      )
        throw new ConflictException({ code: "INVALID_TARIFF_RULE" });
      return {
        serviceCode: rule.serviceCode,
        basePriceMinor: BigInt(rule.basePriceMinor),
        perPagePriceMinor: BigInt(rule.perPagePriceMinor),
        optionPrices: rule.optionPrices,
      };
    });
    if (new Set(rules.map((rule) => rule.serviceCode)).size !== rules.length)
      throw new ConflictException({ code: "DUPLICATE_TARIFF_RULE" });
    const fulfillmentRules = (input.fulfillmentRules ?? []).map((rule) => {
      if (
        !rule ||
        typeof rule !== "object" ||
        !["PICKUP", "DELIVERY"].includes(rule.mode) ||
        !/^[A-Z0-9_]{2,40}$/.test(rule.locationCode) ||
        (rule.mode === "PICKUP") !== (rule.locationCode === "PICKUP") ||
        !/^\d{1,15}$/.test(rule.feeMinor)
      )
        throw new ConflictException({ code: "INVALID_FULFILLMENT_RULE" });
      return {
        mode: rule.mode,
        locationCode: rule.locationCode,
        feeMinor: BigInt(rule.feeMinor),
        enabled: rule.enabled ?? true,
      };
    });
    if (
      new Set(
        fulfillmentRules.map((rule) => `${rule.mode}:${rule.locationCode}`),
      ).size !== fulfillmentRules.length
    )
      throw new ConflictException({ code: "DUPLICATE_FULFILLMENT_RULE" });
    const tariff = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.tariffVersion.findFirst({
          orderBy: { version: "desc" },
        });
        if (current?.status === "ACTIVE")
          await tx.tariffVersion.update({
            where: { id: current.id },
            data: { status: "RETIRED", retiredAt: new Date() },
          });
        const created = await tx.tariffVersion.create({
          data: {
            version: (current?.version ?? 0) + 1,
            basePriceMinor: base,
            perPagePriceMinor: perPage,
            createdById: actorId,
            rules: { create: rules },
            fulfillmentRules: { create: fulfillmentRules },
          },
          include: { fulfillmentRules: true },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "tariff",
            created.id,
            created.version,
            "TARIFF_ACTIVATED",
          ),
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("TARIFF_VERSION_CREATED", actorId, "tariff", {
      status: "ACTIVE",
      operation: "CREATE",
    });
    return tariffView(tariff);
  }

  async tariffs() {
    return (
      await this.prisma.tariffVersion.findMany({
        orderBy: { version: "desc" },
        include: { fulfillmentRules: true },
      })
    ).map(tariffView);
  }

  async currentTariff() {
    const tariff = await this.prisma.tariffVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: { fulfillmentRules: true },
    });
    if (!tariff) throw new NotFoundException({ code: "NO_ACTIVE_TARIFF" });
    return tariffView(tariff);
  }

  async createOrder(
    userId: string,
    key: string | undefined,
    input: CreateOrderDto & { orderDraftVersion?: number },
  ) {
    const prepared = this.idempotency.prepare(
      `order:create:${userId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<ReturnType<typeof orderView>>(prepared);
    if (replay) return replay;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          if (input.orderDraftId)
            await tx.$queryRaw`SELECT id FROM "OrderDraft" WHERE id = ${input.orderDraftId}::uuid FOR UPDATE`;
          const approval = await tx.layoutApproval.findFirst({
            where: { id: input.layoutApprovalId, userId },
            include: {
              layout: { include: { upload: true } },
              previewVersion: true,
            },
          });
          if (!approval) throw new NotFoundException();
          const layout = approval.layout;
          if (
            layout.status !== "APPROVED" ||
            layout.currentApprovalId !== approval.id ||
            layout.latestPreviewId !== approval.previewVersionId ||
            !layout.latestPrintReadyId ||
            layout.version !== approval.layoutVersion + 1 ||
            approval.previewVersion.sourceFileVersion !==
              layout.sourceFileVersion ||
            approval.previewVersion.settingsHash !== layout.settingsHash
          )
            throw new ConflictException({
              code: "LAYOUT_APPROVAL_NOT_CURRENT",
            });
          const printReady = await tx.printReadyVersion.findFirst({
            where: {
              id: layout.latestPrintReadyId,
              layoutId: layout.id,
              sourceFileVersion: layout.sourceFileVersion,
              settingsHash: layout.settingsHash,
            },
          });
          if (!printReady)
            throw new ConflictException({ code: "PRINT_READY_NOT_CURRENT" });
          const tariff = await tx.tariffVersion.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { version: "desc" },
          });
          if (!tariff)
            throw new ConflictException({ code: "NO_ACTIVE_TARIFF" });
          let quoted:
            | {
                id: string;
                lineItems: Prisma.JsonValue;
                subtotalMinor: bigint;
                discountMinor: bigint;
                totalMinor: bigint;
                sourceParameters: Prisma.JsonValue;
              }
            | undefined;
          let studioSelection:
            | Prisma.OrderStudioSelectionSnapshotCreateWithoutOrderInput
            | undefined;
          let fulfillmentSelection:
            | Prisma.OrderFulfillmentSelectionSnapshotCreateWithoutOrderInput
            | undefined;
          if (input.orderDraftId || input.priceQuoteId) {
            if (!input.orderDraftId || !input.priceQuoteId)
              throw new ConflictException({ code: "QUOTE_LINEAGE_REQUIRED" });
            const quote = await tx.priceQuote.findFirst({
              where: { id: input.priceQuoteId, draftId: input.orderDraftId },
              include: {
                draft: {
                  include: {
                    catalogVersion: true,
                    catalogItem: true,
                    studioPreference: {
                      include: {
                        listing: {
                          include: {
                            branch: {
                              include: {
                                partner: true,
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
                            },
                          },
                        },
                      },
                    },
                    fulfillmentPreference: true,
                  },
                },
                fulfillmentTariffRule: true,
              },
            });
            if (!quote || quote.draft.userId !== userId)
              throw new NotFoundException();
            if (
              quote.status !== "ACTIVE" ||
              quote.expiresAt <= new Date() ||
              quote.draft.status !== "QUOTED" ||
              quote.draft.version !== quote.draftVersion ||
              (input.orderDraftVersion !== undefined &&
                quote.draftVersion !== input.orderDraftVersion) ||
              quote.draft.layoutApprovalId !== approval.id ||
              quote.layoutApprovalId !== approval.id ||
              quote.layoutVersion !== layout.version ||
              quote.catalogVersionId !== quote.draft.catalogVersionId ||
              quote.catalogItemId !== quote.draft.catalogItemId ||
              quote.draft.catalogVersion.status !== "ACTIVE" ||
              quote.tariffVersionId !== tariff.id ||
              quote.quantity !== input.quantity
            )
              throw new ConflictException({ code: "QUOTE_STALE" });
            const rule = await tx.tariffRule.findUnique({
              where: {
                tariffVersionId_serviceCode: {
                  tariffVersionId: tariff.id,
                  serviceCode: quote.draft.serviceCode,
                },
              },
            });
            const fulfillmentPreference = quote.draft.fulfillmentPreference
              ?.invalidatedAt
              ? undefined
              : quote.draft.fulfillmentPreference;
            const fulfillmentRule = quote.fulfillmentTariffRule;
            if (
              quote.draft.fulfillmentRequired &&
              (!fulfillmentPreference || !fulfillmentRule)
            )
              throw new ConflictException({
                code: "FULFILLMENT_SELECTION_REQUIRED",
              });
            if (
              fulfillmentPreference &&
              (!fulfillmentRule ||
                quote.fulfillmentPreferenceVersion !==
                  fulfillmentPreference.version ||
                fulfillmentRule.tariffVersionId !== tariff.id ||
                fulfillmentRule.mode !== fulfillmentPreference.mode ||
                fulfillmentRule.locationCode !==
                  fulfillmentPreference.locationCode ||
                !fulfillmentRule.enabled)
            )
              throw new ConflictException({ code: "QUOTE_STALE" });
            const recalculated = calculateCustomerPrice({
              basePriceMinor: rule?.basePriceMinor ?? tariff.basePriceMinor,
              perPagePriceMinor:
                rule?.perPagePriceMinor ?? tariff.perPagePriceMinor,
              optionPrices: rule?.optionPrices ?? {},
              pageCount: printReady.pageCount,
              quantity: input.quantity,
              configuration: quote.draft.configuration as Record<
                string,
                unknown
              >,
              fulfillmentFeeMinor: fulfillmentRule?.feeMinor,
            });
            if (
              recalculated.totalMinor !== quote.totalMinor ||
              recalculated.subtotalMinor !== quote.subtotalMinor ||
              canonicalJson(recalculated.lineItems) !==
                canonicalJson(quote.lineItems)
            )
              throw new ConflictException({ code: "QUOTE_STALE" });
            quoted = {
              id: quote.id,
              lineItems: quote.lineItems,
              subtotalMinor: quote.subtotalMinor,
              discountMinor: quote.discountMinor,
              totalMinor: quote.totalMinor,
              sourceParameters: quote.sourceParameters,
            };
            if (fulfillmentPreference && fulfillmentRule) {
              fulfillmentSelection = {
                mode: fulfillmentPreference.mode,
                locationCode: fulfillmentPreference.locationCode,
                addressCiphertext: fulfillmentPreference.addressCiphertext,
                addressIv: fulfillmentPreference.addressIv,
                addressAuthTag: fulfillmentPreference.addressAuthTag,
                addressKeyVersion: fulfillmentPreference.addressKeyVersion,
                sourcePreferenceVersion: fulfillmentPreference.version,
                feeMinor: fulfillmentRule.feeMinor,
                currency: tariff.currency,
                fulfillmentTariffRule: {
                  connect: { id: fulfillmentRule.id },
                },
              };
            }
            const preference = quote.draft.studioPreference;
            if (preference?.mode === "PREFERRED_STUDIO") {
              const listing = preference.listing;
              const branch = listing?.branch;
              const capability = branch?.capabilityVersions[0];
              const operational = branch?.operationalVersions[0];
              const catalog = branch?.catalogVersions[0];
              const capacity = branch?.capacityVersions[0];
              if (
                !listing ||
                listing.status !== "PUBLISHED" ||
                !branch ||
                !branch.active ||
                !branch.acceptingOrders ||
                !["ACTIVE", "APPROVED"].includes(branch.partner.status) ||
                !capability ||
                !operational ||
                !catalog ||
                !capacity ||
                preference.capabilityVersionId !== capability.id ||
                preference.operationalVersionId !== operational.id ||
                preference.catalogVersionId !== catalog.id ||
                preference.capacityVersionId !== capacity.id
              )
                throw new ConflictException({
                  code: "STUDIO_PREFERENCE_STALE",
                });
              studioSelection = {
                mode: preference.mode,
                fallbackPolicy: preference.fallbackPolicy,
                listingSequence: listing.sequence,
                listing: { connect: { id: listing.id } },
                branch: { connect: { id: branch.id } },
                capabilityVersion: { connect: { id: capability.id } },
                operationalVersion: { connect: { id: operational.id } },
                catalogVersion: { connect: { id: catalog.id } },
                capacityVersion: { connect: { id: capacity.id } },
              };
            } else {
              studioSelection = {
                mode: "AUTO_ASSIGN",
                fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
              };
            }
          }
          const pageUnits = BigInt(printReady.pageCount * input.quantity);
          const pageTotal = tariff.perPagePriceMinor * pageUnits;
          const legacySubtotal = tariff.basePriceMinor + pageTotal;
          const created = await tx.order.create({
            data: {
              userId,
              layoutId: layout.id,
              layoutApprovalId: approval.id,
              printReadyVersionId: printReady.id,
              orderDraftId: input.orderDraftId,
              priceQuoteId: quoted?.id,
              priceSnapshot: {
                create: {
                  tariffVersionId: tariff.id,
                  tariffVersion: tariff.version,
                  sourceParameters: quoted?.sourceParameters ?? {
                    fileKind: layout.upload.fileKind,
                    pageCount: printReady.pageCount,
                    layoutSettings: layout.settings,
                  },
                  lineItems: quoted?.lineItems ?? [
                    {
                      code: "BASE",
                      quantity: 1,
                      unitPriceMinor: tariff.basePriceMinor.toString(),
                      totalMinor: tariff.basePriceMinor.toString(),
                    },
                    {
                      code: "PAGE",
                      quantity: pageUnits.toString(),
                      unitPriceMinor: tariff.perPagePriceMinor.toString(),
                      totalMinor: pageTotal.toString(),
                    },
                  ],
                  quantity: input.quantity,
                  subtotalMinor: quoted?.subtotalMinor ?? legacySubtotal,
                  discountMinor: quoted?.discountMinor ?? 0n,
                  totalMinor: quoted?.totalMinor ?? legacySubtotal,
                  currency: "UZS",
                },
              },
              studioSelection: studioSelection
                ? { create: studioSelection }
                : undefined,
              fulfillmentSelection: fulfillmentSelection
                ? { create: fulfillmentSelection }
                : undefined,
            },
            include: orderInclude,
          });
          await tx.outboxEvent.create({
            data: outbox("order", created.id, created.version, "ORDER_CREATED"),
          });
          if (fulfillmentSelection)
            await tx.auditEvent.create({
              data: {
                actorId: userId,
                eventType: "FULFILLMENT_SELECTION_SNAPSHOTTED",
                targetType: "order",
                metadata: {
                  operation: fulfillmentSelection.mode,
                  status: "FROZEN",
                  locationClass: fulfillmentSelection.locationCode,
                },
              },
            });
          if (quoted && input.orderDraftId) {
            await tx.priceQuote.update({
              where: { id: quoted.id },
              data: { status: "CONSUMED", consumedAt: new Date() },
            });
            await tx.orderDraft.update({
              where: { id: input.orderDraftId },
              data: {
                status: "CHECKED_OUT",
                checkedOutAt: new Date(),
                version: { increment: 1 },
              },
            });
          }
          const response = orderView(created);
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              response as unknown as Prisma.InputJsonValue,
              201,
            ),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.audit.record("ORDER_CREATED", userId, "order", {
        status: "AWAITING_PAYMENT",
      });
      return result;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async ownOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException();
    return orderView(order);
  }

  async startPayment(
    userId: string,
    orderId: string,
    key: string | undefined,
    input: StartPaymentDto,
  ) {
    if (this.env.paymentProvider === "mock" && !input.simulateOutcome)
      throw new ConflictException({ code: "MOCK_OUTCOME_REQUIRED" });
    const prepared = this.idempotency.prepare(
      `payment:start:${orderId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException();
    if (order.status !== "AWAITING_PAYMENT" || !order.priceSnapshot)
      throw new ConflictException({ code: "ORDER_NOT_PAYABLE" });
    if (order.payment?.status === "SUCCEEDED")
      throw new ConflictException({ code: "PAYMENT_ALREADY_SUCCEEDED" });
    const provider = await this.payments.start(
      order.id,
      order.priceSnapshot.totalMinor,
      "UZS",
      { idempotencyKey: prepared.keyDigest, correlationId: order.id },
    );
    const callback: PaymentCallbackDto | undefined =
      this.env.paymentProvider === "mock"
        ? {
            eventId: randomUUID(),
            paymentReference: provider.reference,
            outcome:
              input.simulateOutcome === "SUCCESS"
                ? "PAYMENT_SUCCEEDED"
                : "PAYMENT_FAILED",
          }
        : undefined;
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const payment = order.payment
          ? await tx.payment.update({
              where: { id: order.payment.id },
              data: {
                providerPaymentReference: provider.reference,
                status: "PENDING",
                version: { increment: 1 },
              },
            })
          : await tx.payment.create({
              data: {
                orderId: order.id,
                provider: this.env.paymentProvider,
                providerPaymentReference: provider.reference,
                amountMinor: order.priceSnapshot!.totalMinor,
                currency: "UZS",
              },
            });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            payment.version,
            "PAYMENT_STARTED",
          ),
        });
        const value = {
          orderId: order.id,
          paymentStatus: payment.status,
          ...(callback
            ? {
                mockCallback: callback,
                mockSignature: this.mockPayments.sign(JSON.stringify(callback)),
              }
            : {}),
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            value as unknown as Prisma.InputJsonValue,
          ),
        });
        return value;
      });
      await this.audit.record("PAYMENT_STARTED", userId, "payment", {
        status: "PENDING",
        operation: "PAY",
      });
      return response;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async callbackRaw(rawPayload: string, signature: string | undefined) {
    const input = this.payments.parseWebhook(rawPayload, signature);
    if (!input)
      throw new ForbiddenException({ code: "INVALID_PROVIDER_SIGNATURE" });
    if (this.env.paymentProvider === "mock")
      this.mockPayments.recordOutcome(input.paymentReference, input.outcome);
    const payloadHash = digest(rawPayload);
    const existing = await this.prisma.providerCallback.findUnique({
      where: {
        provider_eventId: {
          provider: this.env.paymentProvider,
          eventId: input.eventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
      return existing.result;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const located = await tx.payment.findFirst({
          where: {
            OR: [
              { providerPaymentReference: input.paymentReference },
              {
                refunds: {
                  some: { providerRefundReference: input.paymentReference },
                },
              },
            ],
          },
          include: { order: true, refunds: true },
        });
        if (!located) throw new NotFoundException();
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${located.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${located.id}::uuid FOR UPDATE`;
        const prior = await tx.providerCallback.findUnique({
          where: {
            provider_eventId: {
              provider: this.env.paymentProvider,
              eventId: input.eventId,
            },
          },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
          return prior.result;
        }
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: located.id },
          include: { order: true, refunds: true },
        });
        if (
          input.outcome !== "REFUND_SUCCEEDED" &&
          payment.providerPaymentReference !== input.paymentReference
        )
          throw new ConflictException({ code: "INVALID_PAYMENT_REFERENCE" });
        let paymentStatus: PaymentStatus;
        let orderStatus:
          | "AWAITING_PAYMENT"
          | "PAID"
          | "REFUND_PENDING"
          | "PARTIALLY_REFUNDED"
          | "REFUNDED";
        let eventType: string;
        if (input.outcome === "PAYMENT_SUCCEEDED") {
          if (payment.status === "SUCCEEDED" && payment.order.status === "PAID")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            payment.status !== "PENDING" ||
            payment.order.status !== "AWAITING_PAYMENT"
          )
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "SUCCEEDED";
          orderStatus = "PAID";
          eventType = "PAYMENT_SUCCEEDED";
        } else if (input.outcome === "PAYMENT_FAILED") {
          if (payment.status === "FAILED")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            payment.status !== "PENDING" ||
            payment.order.status !== "AWAITING_PAYMENT"
          )
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "FAILED";
          orderStatus = "AWAITING_PAYMENT";
          eventType = "PAYMENT_FAILED";
        } else {
          const refund = payment.refunds.find(
            (item) => item.providerRefundReference === input.paymentReference,
          );
          if (refund?.status === "CONFIRMED")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            !refund ||
            refund.providerRefundReference !== input.paymentReference ||
            payment.status !== "REFUND_PENDING" ||
            payment.order.status !== "REFUND_PENDING"
          )
            throw new ConflictException({ code: "INVALID_REFUND_TRANSITION" });
          const confirmedTotal =
            payment.refunds
              .filter((item) => item.status === "CONFIRMED")
              .reduce((sum, item) => sum + item.amountMinor, 0n) +
            refund.amountMinor;
          const fullyRefunded = confirmedTotal >= payment.amountMinor;
          paymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
          orderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
          eventType = "REFUND_CONFIRMED";
          await tx.refundOperation.update({
            where: { id: refund.id },
            data: { status: "CONFIRMED", confirmedAt: new Date() },
          });
        }
        const changedPayment = await tx.payment.update({
          where: {
            id: payment.id,
            version: payment.version,
            status: payment.status,
          },
          data: { status: paymentStatus, version: { increment: 1 } },
        });
        const changedOrder = await tx.order.update({
          where: {
            id: payment.orderId,
            version: payment.order.version,
            status: payment.order.status,
          },
          data: { status: orderStatus, version: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            changedPayment.version,
            eventType,
          ),
        });
        const result = {
          accepted: true,
          paymentStatus: changedPayment.status,
          orderStatus: changedOrder.status,
        };
        await tx.providerCallback.create({
          data: {
            provider: this.env.paymentProvider,
            eventId: input.eventId,
            payloadHash,
            result,
          },
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.prisma.providerCallback.findUniqueOrThrow({
          where: {
            provider_eventId: {
              provider: this.env.paymentProvider,
              eventId: input.eventId,
            },
          },
        });
        if (replay.payloadHash !== payloadHash)
          throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
        return replay.result;
      }
      throw error;
    }
  }

  callback(input: PaymentCallbackDto, signature: string | undefined) {
    return this.callbackRaw(JSON.stringify(input), signature);
  }

  async confirmPayment(
    userId: string,
    orderId: string,
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `payment:confirm:${orderId}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: true },
    });
    if (!order) throw new NotFoundException();
    if (
      order.status !== "AWAITING_PAYMENT" ||
      order.payment?.status !== "PENDING" ||
      !order.payment.providerPaymentReference
    )
      throw new ConflictException({ code: "PAYMENT_NOT_CONFIRMABLE" });
    const provider = await this.payments.confirm(
      order.payment.providerPaymentReference,
      {
        idempotencyKey: digest(
          `confirm:${order.payment.id}:${order.payment.version}`,
        ),
        correlationId: order.payment.id,
      },
    );
    const response = await this.prisma.$transaction(async (tx) => {
      const value = { orderId, paymentStatus: provider.status };
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(prepared, value),
      });
      const event = outbox(
        "payment",
        order.payment!.id,
        order.payment!.version,
        "PAYMENT_CONFIRMATION_REQUESTED",
      );
      await tx.outboxEvent.upsert({
        where: { dedupKey: event.dedupKey },
        create: event,
        update: {},
      });
      return value;
    });
    await this.audit.record(
      "PAYMENT_CONFIRMATION_REQUESTED",
      userId,
      "payment",
      {
        status: "PENDING",
        operation: "CONFIRM",
      },
    );
    return response;
  }

  async mockCallback(input: PaymentCallbackDto, signature: string | undefined) {
    if (
      this.env.paymentProvider !== "mock" ||
      this.env.nodeEnv === "production"
    )
      throw new ForbiddenException({ code: "MOCK_PROVIDER_FORBIDDEN" });
    return this.callback(input, signature);
  }

  async requestNoExecutorRefund(
    actorId: string | undefined,
    orderId: string,
    key: string | undefined,
    input: NoExecutorRefundDto,
  ) {
    const prepared = this.idempotency.prepare(
      `refund:no-executor:${orderId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    const triggerDedupKey = digest(
      `NO_EXECUTOR:${input.syntheticEventReference}`,
    );
    const priorRefund = await this.prisma.refundOperation.findUnique({
      where: { triggerDedupKey },
      include: { payment: { include: { order: true } } },
    });
    if (priorRefund) {
      if (priorRefund.payment.orderId !== orderId)
        throw new ConflictException({ code: "REFUND_EVENT_CONFLICT" });
      return {
        orderId,
        orderStatus: priorRefund.payment.order.status,
        paymentStatus: priorRefund.payment.status,
        refundStatus: priorRefund.status,
      };
    }
    if (
      !order?.payment ||
      order.payment.status !== "SUCCEEDED" ||
      !["PAID", "MATCHING", "PARTNER_OFFERED"].includes(order.status)
    )
      throw new ConflictException({ code: "ORDER_NOT_REFUNDABLE" });
    const provider = await this.payments.refund(
      order.payment.providerPaymentReference!,
      order.payment.amountMinor,
      { idempotencyKey: triggerDedupKey, correlationId: order.id },
    );
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const refund = await tx.refundOperation.create({
          data: {
            paymentId: order.payment!.id,
            triggerDedupKey,
            providerRefundReference: provider.reference,
            amountMinor: order.payment!.amountMinor,
          },
        });
        const payment = await tx.payment.update({
          where: { id: order.payment!.id },
          data: { status: "REFUND_PENDING", version: { increment: 1 } },
        });
        const changedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "REFUND_PENDING", version: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            payment.version,
            "REFUND_REQUESTED",
          ),
        });
        const callback: PaymentCallbackDto = {
          eventId: randomUUID(),
          paymentReference: provider.reference,
          outcome: "REFUND_SUCCEEDED",
        };
        const value = {
          orderId: order.id,
          orderStatus: changedOrder.status,
          paymentStatus: payment.status,
          refundStatus: refund.status,
          mockCallback: callback,
          mockSignature: this.mockPayments.sign(JSON.stringify(callback)),
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            value as unknown as Prisma.InputJsonValue,
          ),
        });
        return value;
      });
      await this.audit.record("REFUND_REQUESTED", actorId, "payment", {
        status: "REFUND_PENDING",
        operation: "NO_EXECUTOR",
      });
      return response;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async financeAudit() {
    return this.prisma.auditEvent.findMany({
      where: {
        eventType: {
          in: [
            "TARIFF_VERSION_CREATED",
            "ORDER_CREATED",
            "PAYMENT_STARTED",
            "REFUND_REQUESTED",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        eventType: true,
        targetType: true,
        metadata: true,
        createdAt: true,
      },
    });
  }

  async dispatchRefundOperation(operationId: string) {
    const operation = await this.prisma.refundOperation.findUnique({
      where: { id: operationId },
      include: { payment: true },
    });
    if (!operation) throw new NotFoundException();
    if (!operation.payment.providerPaymentReference)
      throw new ConflictException({ code: "PAYMENT_REFERENCE_MISSING" });
    const provider = operation.providerRefundReference
      ? { reference: operation.providerRefundReference }
      : await this.payments.refund(
          operation.payment.providerPaymentReference,
          operation.amountMinor,
          {
            idempotencyKey: operation.triggerDedupKey,
            correlationId: operation.paymentId,
          },
        );
    await this.prisma.$transaction(async (tx) => {
      await tx.refundOperation.updateMany({
        where: { id: operation.id, providerRefundReference: null },
        data: { providerRefundReference: provider.reference },
      });
      const next = outbox(
        "refund",
        operation.id,
        1,
        "AFTERCARE_MOCK_REFUND_CALLBACK",
      );
      await tx.outboxEvent.upsert({
        where: { dedupKey: next.dedupKey },
        create: next,
        update: {},
      });
    });
    return { dispatched: true };
  }

  async confirmMockRefund(operationId: string) {
    if (
      this.env.nodeEnv === "production" ||
      this.env.paymentProvider !== "mock"
    )
      throw new ForbiddenException({ code: "MOCK_PROVIDER_FORBIDDEN" });
    const refund = await this.prisma.refundOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    if (!refund.providerRefundReference)
      throw new ConflictException({ code: "REFUND_NOT_DISPATCHED" });
    const input: PaymentCallbackDto = {
      eventId: operationId,
      paymentReference: refund.providerRefundReference,
      outcome: "REFUND_SUCCEEDED",
    };
    return this.callback(input, this.mockPayments.sign(JSON.stringify(input)));
  }

  private async handleIdempotencyRace(
    error: unknown,
    prepared: ReturnType<IdempotencyService["prepare"]>,
  ): Promise<unknown> {
    const prismaError =
      error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
    const retryable =
      prismaError?.code === "P2002" ||
      prismaError?.code === "P2034" ||
      (prismaError?.code === "P2010" &&
        typeof prismaError.meta === "object" &&
        prismaError.meta !== null &&
        "code" in prismaError.meta &&
        prismaError.meta.code === "40001");
    if (retryable) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (existing)
        return this.idempotency.assertCompatible(existing, prepared);
      throw new ConflictException({ code: "CONCURRENT_CHANGE" });
    }
    throw error;
  }

  private async storeRepeatedCallback(
    tx: Prisma.TransactionClient,
    input: PaymentCallbackDto,
    payloadHash: string,
    payment: { status: PaymentStatus; order: { status: string } },
  ) {
    const result = {
      accepted: true,
      paymentStatus: payment.status,
      orderStatus: payment.order.status,
    };
    await tx.providerCallback.create({
      data: {
        provider: this.env.paymentProvider,
        eventId: input.eventId,
        payloadHash,
        result,
      },
    });
    return result;
  }
}
