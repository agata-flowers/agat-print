import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type PaymentAttemptStatus,
  type PaymentStatus,
} from "@prisma/client";
import type { PaymentProvider, PaymentScenario } from "@agat/providers";
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
import {
  paymentSnapshotDigest,
  paymentTransition,
  protectProviderReference,
  providerReferenceDigest,
  revealProviderReference,
  type PaymentObservation,
} from "./payment-domain";

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
    include: {
      refunds: { orderBy: { createdAt: "desc" as const } },
      attempts: { orderBy: { sequence: "desc" as const }, take: 1 },
    },
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
  items: {
    orderBy: { sequence: "asc" as const },
    select: {
      sequence: true,
      serviceCode: true,
      quantity: true,
      totalMinor: true,
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
  items: order.items.map((item) => ({
    sequence: item.sequence,
    serviceCode: item.serviceCode,
    quantity: item.quantity,
    totalMinor: item.totalMinor.toString(),
    currency: item.currency,
  })),
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
        attempt: order.payment.attempts[0]
          ? {
              status: order.payment.attempts[0].status,
              method: order.payment.attempts[0].method,
              failureCode: order.payment.attempts[0].failureCode,
              createdAt: order.payment.attempts[0].createdAt,
              startedAt: order.payment.attempts[0].startedAt,
              completedAt: order.payment.attempts[0].completedAt,
            }
          : null,
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
          // Dual-write the normalized Stage 15 item projection for every
          // legacy single-draft checkout. The accepted Order pointers remain
          // the compatibility projection for sequence one.
          if (input.orderDraftId) {
            const sourceDraft = await tx.orderDraft.findUniqueOrThrow({
              where: { id: input.orderDraftId },
              select: {
                catalogItemId: true,
                serviceCode: true,
                configuration: true,
              },
            });
            const fulfillmentFee = BigInt(
              fulfillmentSelection?.feeMinor?.toString() ?? "0",
            );
            const allocatedTotal =
              (quoted?.totalMinor ?? legacySubtotal) - fulfillmentFee;
            await tx.orderItem.create({
              data: {
                orderId: created.id,
                sequence: 1,
                sourceDraftId: input.orderDraftId,
                catalogItemId: sourceDraft.catalogItemId,
                serviceCode: sourceDraft.serviceCode,
                configuration:
                  sourceDraft.configuration as Prisma.InputJsonValue,
                configurationHash: digest(
                  canonicalJson(sourceDraft.configuration),
                ),
                quantity: input.quantity,
                layoutId: layout.id,
                layoutApprovalId: approval.id,
                printReadyVersionId: printReady.id,
                subtotalMinor: allocatedTotal,
                discountMinor: 0n,
                totalMinor: allocatedTotal,
                currency: "UZS",
              },
            });
          }
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

  async paymentMethods(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true, priceSnapshot: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException();
    if (order.status !== "AWAITING_PAYMENT" || !order.priceSnapshot)
      throw new ConflictException({ code: "ORDER_NOT_PAYABLE" });
    const capabilities = await this.payments.capabilities();
    return {
      methods: capabilities.methods.map((code) => ({
        code,
        labelRu: code === "INTERNAL_MVP" ? "Тестовая оплата" : "Онлайн-оплата",
        labelUz: code === "INTERNAL_MVP" ? "Sinov to‘lovi" : "Onlayn to‘lov",
        labelEn: code === "INTERNAL_MVP" ? "Demo payment" : "Online payment",
      })),
    };
  }

  async paymentProjection(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        payment: {
          include: { attempts: { orderBy: { sequence: "desc" }, take: 1 } },
        },
      },
    });
    if (!order) throw new NotFoundException();
    const payment = order.payment;
    const attempt = payment?.attempts[0];
    return {
      orderStatus: order.status,
      payment: payment
        ? {
            status: payment.status,
            amountMinor: payment.amountMinor.toString(),
            currency: payment.currency,
            failureCode: payment.lastFailureCode,
            nextReconcileAt: payment.nextReconcileAt,
          }
        : null,
      attempt: attempt
        ? {
            status: attempt.status,
            method: attempt.method,
            failureCode: attempt.failureCode,
            createdAt: attempt.createdAt,
            startedAt: attempt.startedAt,
            completedAt: attempt.completedAt,
          }
        : null,
    };
  }

  async startPayment(
    userId: string,
    orderId: string,
    key: string | undefined,
    input: StartPaymentDto,
  ) {
    const method =
      input.method ??
      (["mock", "internal"].includes(this.env.paymentProvider)
        ? "INTERNAL_MVP"
        : "PROVIDER_REDIRECT");
    if (
      (method === "INTERNAL_MVP") !==
      ["mock", "internal"].includes(this.env.paymentProvider)
    )
      throw new ConflictException({ code: "PAYMENT_METHOD_UNAVAILABLE" });
    const scenario = (input.scenario ?? input.simulateOutcome) as
      | PaymentScenario
      | undefined;
    if (method === "INTERNAL_MVP" && !scenario)
      throw new ConflictException({ code: "INTERNAL_SCENARIO_REQUIRED" });
    const prepared = this.idempotency.prepare(
      `payment:start:${orderId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findFirst({
          where: { id: orderId, userId },
          include: {
            priceSnapshot: true,
            fulfillmentSelection: { select: { id: true } },
            studioSelection: { select: { id: true } },
            payment: {
              include: { attempts: { orderBy: { sequence: "desc" } } },
            },
          },
        });
        if (!order) throw new NotFoundException();
        if (order.status !== "AWAITING_PAYMENT" || !order.priceSnapshot)
          throw new ConflictException({ code: "ORDER_NOT_PAYABLE" });
        if (
          input.expectedOrderVersion !== undefined &&
          input.expectedOrderVersion !== order.version
        )
          throw new ConflictException({ code: "STALE_ORDER_VERSION" });
        if (order.priceSnapshot.currency !== "UZS")
          throw new ConflictException({ code: "PAYMENT_CURRENCY_INVALID" });
        if (order.payment?.status === "SUCCEEDED")
          throw new ConflictException({ code: "PAYMENT_ALREADY_SUCCEEDED" });
        if (
          order.payment?.attempts.some((attempt) =>
            ["CREATED", "PROCESSING", "UNKNOWN"].includes(attempt.status),
          )
        )
          throw new ConflictException({ code: "PAYMENT_ATTEMPT_ACTIVE" });
        const payment = order.payment
          ? await tx.payment.update({
              where: { id: order.payment.id },
              data: {
                provider: this.env.paymentProvider,
                status: "PENDING",
                lastFailureCode: null,
                nextReconcileAt: null,
                version: { increment: 1 },
              },
            })
          : await tx.payment.create({
              data: {
                orderId: order.id,
                provider: this.env.paymentProvider,
                amountMinor: order.priceSnapshot.totalMinor,
                currency: "UZS",
              },
            });
        const sequence = (order.payment?.attempts[0]?.sequence ?? 0) + 1;
        const attempt = await tx.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            sequence,
            method,
            scenario,
            provider: this.env.paymentProvider,
            amountMinor: order.priceSnapshot.totalMinor,
            currency: "UZS",
            snapshotDigest: paymentSnapshotDigest({
              orderId: order.id,
              priceSnapshotId: order.priceSnapshot.id,
              totalMinor: order.priceSnapshot.totalMinor,
              currency: order.priceSnapshot.currency,
              fulfillmentSnapshotId: order.fulfillmentSelection?.id,
              studioSnapshotId: order.studioSelection?.id,
            }),
            merchantReference: randomUUID(),
            expiresAt: new Date(
              Date.now() + this.env.paymentAttemptTimeoutSeconds * 1000,
            ),
          },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "payment_attempt",
            attempt.id,
            attempt.version,
            "PAYMENT_ATTEMPT_CREATED",
          ),
        });
        const value = {
          orderId: order.id,
          paymentStatus: payment.status,
          attemptStatus: attempt.status,
          method: attempt.method,
          nextAction: "WAIT" as const,
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            value as unknown as Prisma.InputJsonValue,
          ),
        });
        return { value, attemptId: attempt.id };
      });
      let dispatched:
        | Awaited<ReturnType<CommerceService["dispatchPaymentAttempt"]>>
        | undefined;
      try {
        dispatched = await this.dispatchPaymentAttempt(
          created.attemptId,
          scenario,
        );
      } catch (error) {
        if (
          !(
            error instanceof ConflictException &&
            (error.getResponse() as { code?: string }).code ===
              "PAYMENT_PROVIDER_RETRY_SCHEDULED"
          )
        )
          throw error;
      }
      const callback: PaymentCallbackDto | undefined =
        this.env.paymentProvider === "mock" &&
        input.simulateOutcome &&
        dispatched
          ? {
              eventId: randomUUID(),
              paymentReference: dispatched.reference,
              outcome:
                input.simulateOutcome === "SUCCESS"
                  ? "PAYMENT_SUCCEEDED"
                  : "PAYMENT_FAILED",
            }
          : undefined;
      const response = {
        ...created.value,
        paymentStatus: dispatched?.paymentStatus ?? created.value.paymentStatus,
        attemptStatus: dispatched?.attemptStatus ?? created.value.attemptStatus,
        ...(callback
          ? {
              mockCallback: callback,
              mockSignature: this.mockPayments.sign(JSON.stringify(callback)),
            }
          : {}),
      };
      await this.prisma.idempotencyRecord.updateMany({
        where: { scope: prepared.scope, keyDigest: prepared.keyDigest },
        data: { response: response as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record("PAYMENT_STARTED", userId, "payment", {
        status: response.paymentStatus,
        operation: "PAY",
      });
      return response;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async dispatchPaymentAttempt(
    attemptId: string,
    scenario?: PaymentScenario,
  ): Promise<{
    reference: string;
    paymentStatus: PaymentStatus;
    attemptStatus: PaymentAttemptStatus;
  }> {
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: {
        payment: {
          include: {
            order: {
              include: {
                priceSnapshot: true,
                fulfillmentSelection: { select: { id: true } },
                studioSelection: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (attempt.status !== "CREATED") {
      if (!attempt.providerReferenceCiphertext)
        throw new ConflictException({ code: "PAYMENT_REFERENCE_UNAVAILABLE" });
      return {
        reference: revealProviderReference(
          attempt.providerReferenceCiphertext,
          this.env.paymentReferenceKey,
        ),
        paymentStatus: attempt.payment.status,
        attemptStatus: attempt.status,
      };
    }
    const order = attempt.payment.order;
    if (!order.priceSnapshot)
      throw new ConflictException({ code: "PRICE_MISSING" });
    const expectedDigest = paymentSnapshotDigest({
      orderId: order.id,
      priceSnapshotId: order.priceSnapshot.id,
      totalMinor: order.priceSnapshot.totalMinor,
      currency: order.priceSnapshot.currency,
      fulfillmentSnapshotId: order.fulfillmentSelection?.id,
      studioSnapshotId: order.studioSelection?.id,
    });
    if (expectedDigest !== attempt.snapshotDigest)
      throw new ConflictException({ code: "PAYMENT_LINEAGE_STALE" });
    let provider: Awaited<ReturnType<PaymentProvider["createAttempt"]>>;
    try {
      provider = await this.payments.createAttempt(
        {
          orderReference: order.id,
          merchantReference: attempt.merchantReference,
          method: attempt.method,
          amountMinor: attempt.amountMinor,
          currency: "UZS",
          scenario:
            attempt.scenario === "RETRY" && attempt.failureCode
              ? "SUCCESS"
              : (scenario ?? attempt.scenario ?? undefined),
        },
        {
          idempotencyKey: digest(`attempt:${attempt.merchantReference}`),
          correlationId: attempt.id,
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "PROVIDER_TEMPORARY_FAILURE"
      ) {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentAttempt.updateMany({
            where: {
              id: attempt.id,
              version: attempt.version,
              status: "CREATED",
            },
            data: {
              failureCode: "PROVIDER_TEMPORARY_FAILURE",
              nextReconcileAt: new Date(),
              version: { increment: 1 },
            },
          });
          await tx.payment.updateMany({
            where: { id: attempt.paymentId, version: attempt.payment.version },
            data: {
              lastFailureCode: "PROVIDER_TEMPORARY_FAILURE",
              nextReconcileAt: new Date(),
              version: { increment: 1 },
            },
          });
        });
        throw new ConflictException({
          code: "PAYMENT_PROVIDER_RETRY_SCHEDULED",
        });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentAttempt.updateMany({
          where: {
            id: attempt.id,
            version: attempt.version,
            status: "CREATED",
          },
          data: {
            status: "UNKNOWN",
            failureCode: "PROVIDER_TEMPORARY_FAILURE",
            nextReconcileAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.payment.updateMany({
          where: { id: attempt.paymentId, version: attempt.payment.version },
          data: {
            status: "UNKNOWN",
            lastFailureCode: "PROVIDER_TEMPORARY_FAILURE",
            nextReconcileAt: new Date(),
            version: { increment: 1 },
          },
        });
      });
      throw new ConflictException({ code: "PAYMENT_RESULT_UNKNOWN" });
    }
    const nextStatus = provider.status === "UNKNOWN" ? "UNKNOWN" : "PROCESSING";
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, version: attempt.version, status: "CREATED" },
        data: {
          providerReferenceCiphertext: protectProviderReference(
            provider.reference,
            this.env.paymentReferenceKey,
          ),
          providerReferenceDigest: providerReferenceDigest(provider.reference),
          status: nextStatus,
          startedAt: new Date(),
          nextReconcileAt:
            nextStatus === "UNKNOWN"
              ? new Date()
              : new Date(
                  Date.now() + this.env.paymentAttemptTimeoutSeconds * 1000,
                ),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "PAYMENT_ATTEMPT_RACE" });
      const paymentStatus: PaymentStatus =
        nextStatus === "UNKNOWN" ? "UNKNOWN" : "PROCESSING";
      await tx.payment.updateMany({
        where: { id: attempt.paymentId, version: attempt.payment.version },
        data: {
          status: paymentStatus,
          nextReconcileAt:
            nextStatus === "UNKNOWN"
              ? new Date()
              : new Date(
                  Date.now() + this.env.paymentAttemptTimeoutSeconds * 1000,
                ),
          version: { increment: 1 },
        },
      });
      return paymentStatus;
    });
    return {
      reference: provider.reference,
      paymentStatus: updated,
      attemptStatus: nextStatus,
    };
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
                attempts: {
                  some: {
                    providerReferenceDigest: providerReferenceDigest(
                      input.paymentReference,
                    ),
                  },
                },
              },
              {
                refunds: {
                  some: { providerRefundReference: input.paymentReference },
                },
              },
            ],
          },
          include: { order: true, refunds: true, attempts: true },
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
          include: { order: true, refunds: true, attempts: true },
        });
        const attempt = payment.attempts.find(
          (item) =>
            item.providerReferenceDigest ===
            providerReferenceDigest(input.paymentReference),
        );
        if (
          input.outcome !== "REFUND_SUCCEEDED" &&
          payment.providerPaymentReference !== input.paymentReference &&
          !attempt
        )
          throw new ConflictException({ code: "INVALID_PAYMENT_REFERENCE" });
        if (input.outcome === "UNKNOWN_EVENT") {
          const result = {
            accepted: true,
            paymentStatus: payment.status,
            orderStatus: payment.order.status,
          };
          await tx.providerCallback.create({
            data: {
              provider: this.env.paymentProvider,
              eventId: input.eventId,
              paymentAttemptId: attempt?.id,
              payloadHash,
              eventType: input.outcome,
              disposition: "IGNORED_UNKNOWN",
              resultCode: "UNKNOWN_EVENT_IGNORED",
              result,
            },
          });
          return result;
        }
        let paymentStatus: PaymentStatus;
        let orderStatus:
          | "AWAITING_PAYMENT"
          | "PAID"
          | "REFUND_PENDING"
          | "PARTIALLY_REFUNDED"
          | "REFUNDED";
        let eventType: string;
        let disposition:
          | "APPLIED"
          | "DUPLICATE"
          | "OUT_OF_ORDER"
          | "RECONCILIATION_REQUIRED" = "APPLIED";
        if (input.outcome === "PAYMENT_SUCCEEDED") {
          if (payment.status === "SUCCEEDED" && payment.order.status === "PAID")
            return this.storeRepeatedCallback(
              tx,
              input,
              payloadHash,
              payment,
              attempt?.id,
            );
          if (
            ["FAILED", "CANCELLED"].includes(payment.status) ||
            (attempt && ["FAILED", "CANCELLED"].includes(attempt.status))
          ) {
            paymentStatus = "UNKNOWN";
            orderStatus = "AWAITING_PAYMENT";
            eventType = "PAYMENT_RECONCILIATION_REQUIRED";
            disposition = "RECONCILIATION_REQUIRED";
          } else {
            if (
              !["PENDING", "PROCESSING", "UNKNOWN"].includes(payment.status) ||
              payment.order.status !== "AWAITING_PAYMENT"
            )
              throw new ConflictException({
                code: "INVALID_PAYMENT_TRANSITION",
              });
            paymentStatus = "SUCCEEDED";
            orderStatus = "PAID";
            eventType = "PAYMENT_SUCCEEDED";
          }
        } else if (input.outcome === "PAYMENT_FAILED") {
          if (payment.status === "FAILED")
            return this.storeRepeatedCallback(
              tx,
              input,
              payloadHash,
              payment,
              attempt?.id,
            );
          if (payment.status === "SUCCEEDED") {
            const result = {
              accepted: true,
              paymentStatus: payment.status,
              orderStatus: payment.order.status,
            };
            await tx.providerCallback.create({
              data: {
                provider: this.env.paymentProvider,
                eventId: input.eventId,
                paymentAttemptId: attempt?.id,
                payloadHash,
                eventType: input.outcome,
                disposition: "OUT_OF_ORDER",
                resultCode: "TERMINAL_SUCCESS_PRESERVED",
                result,
              },
            });
            return result;
          }
          if (
            !["PENDING", "PROCESSING", "UNKNOWN"].includes(payment.status) ||
            payment.order.status !== "AWAITING_PAYMENT"
          )
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "FAILED";
          orderStatus = "AWAITING_PAYMENT";
          eventType = "PAYMENT_FAILED";
        } else if (input.outcome === "PAYMENT_CANCELLED") {
          if (
            !attempt ||
            !["CREATED", "PROCESSING", "UNKNOWN"].includes(attempt.status)
          )
            throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
          paymentStatus = "CANCELLED";
          orderStatus = "AWAITING_PAYMENT";
          eventType = "PAYMENT_CANCELLED";
        } else if (input.outcome === "PAYMENT_UNKNOWN") {
          if (!attempt || !["PROCESSING", "UNKNOWN"].includes(attempt.status))
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "UNKNOWN";
          orderStatus = "AWAITING_PAYMENT";
          eventType = "PAYMENT_RECONCILIATION_REQUIRED";
          disposition = "RECONCILIATION_REQUIRED";
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
        if (attempt && input.outcome !== "REFUND_SUCCEEDED") {
          const observation: PaymentObservation =
            paymentStatus === "SUCCEEDED"
              ? "SUCCEEDED"
              : paymentStatus === "FAILED"
                ? "FAILED"
                : paymentStatus === "CANCELLED"
                  ? "CANCELLED"
                  : "UNKNOWN";
          const transition = paymentTransition(attempt.status, observation);
          await tx.paymentAttempt.update({
            where: { id: attempt.id, version: attempt.version },
            data: {
              status: transition.attempt,
              failureCode:
                transition.attempt === "FAILED"
                  ? "PROVIDER_DECLINED"
                  : transition.attempt === "UNKNOWN"
                    ? "RECONCILIATION_REQUIRED"
                    : null,
              nextReconcileAt:
                transition.attempt === "UNKNOWN" ? new Date() : null,
              completedAt: ["SUCCEEDED", "FAILED"].includes(transition.attempt)
                ? new Date()
                : null,
              cancelledAt:
                transition.attempt === "CANCELLED" ? new Date() : null,
              version: { increment: 1 },
            },
          });
          paymentStatus = transition.payment;
        }
        const changedPayment = await tx.payment.update({
          where: {
            id: payment.id,
            version: payment.version,
            status: payment.status,
          },
          data: {
            status: paymentStatus,
            lastFailureCode:
              paymentStatus === "FAILED"
                ? "PROVIDER_DECLINED"
                : paymentStatus === "UNKNOWN"
                  ? "RECONCILIATION_REQUIRED"
                  : null,
            nextReconcileAt: paymentStatus === "UNKNOWN" ? new Date() : null,
            version: { increment: 1 },
          },
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
          data:
            eventType === "PAYMENT_RECONCILIATION_REQUIRED" && attempt
              ? outbox(
                  "payment_attempt",
                  attempt.id,
                  attempt.version + 1,
                  eventType,
                )
              : outbox(
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
            paymentAttemptId: attempt?.id,
            payloadHash,
            eventType: input.outcome,
            disposition,
            resultCode: eventType,
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
      include: {
        payment: {
          include: { attempts: { orderBy: { sequence: "desc" }, take: 1 } },
        },
      },
    });
    if (!order) throw new NotFoundException();
    if (!order.payment)
      throw new ConflictException({ code: "PAYMENT_NOT_CONFIRMABLE" });
    if (order.payment.status === "SUCCEEDED" && order.status === "PAID") {
      const value = { orderId, paymentStatus: "SUCCEEDED" as const };
      await this.prisma.idempotencyRecord.create({
        data: this.idempotency.data(prepared, value),
      });
      return value;
    }
    const attempt = order.payment.attempts[0];
    if (!attempt || !["PROCESSING", "UNKNOWN"].includes(attempt.status))
      throw new ConflictException({ code: "PAYMENT_NOT_CONFIRMABLE" });
    const observed = await this.observeAttempt(attempt.id);
    const applied = await this.applyAttemptObservation(
      attempt.id,
      observed,
      "PAYMENT_CONFIRMATION",
    );
    const response = await this.prisma.$transaction(async (tx) => {
      const value = { orderId, paymentStatus: applied.paymentStatus };
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(prepared, value),
      });
      const event = outbox(
        "payment_attempt",
        attempt.id,
        attempt.version,
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

  async cancelPayment(
    userId: string,
    orderId: string,
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `payment:cancel:${orderId}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        payment: {
          include: { attempts: { orderBy: { sequence: "desc" }, take: 1 } },
        },
      },
    });
    if (!order) throw new NotFoundException();
    const attempt = order.payment?.attempts[0];
    if (!attempt || attempt.status === "UNKNOWN")
      throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
    if (!["CREATED", "PROCESSING"].includes(attempt.status))
      throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
    if (attempt.status === "PROCESSING") {
      if (!attempt.providerReferenceCiphertext || !this.payments.cancel)
        throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
      const cancelled = await this.payments.cancel(
        revealProviderReference(
          attempt.providerReferenceCiphertext,
          this.env.paymentReferenceKey,
        ),
        {
          idempotencyKey: digest(`cancel:${attempt.merchantReference}`),
          correlationId: attempt.id,
        },
      );
      if (cancelled.status !== "CANCELLED")
        throw new ConflictException({ code: "PAYMENT_NOT_CANCELLABLE" });
    }
    const applied = await this.applyAttemptObservation(
      attempt.id,
      "CANCELLED",
      "CUSTOMER_CANCEL",
    );
    const response = {
      orderId,
      paymentStatus: applied.paymentStatus,
      attemptStatus: applied.attemptStatus,
    };
    await this.prisma.idempotencyRecord.create({
      data: this.idempotency.data(prepared, response),
    });
    await this.audit.record("PAYMENT_CANCELLED", userId, "payment", {
      status: applied.paymentStatus,
      operation: "CANCEL",
    });
    return response;
  }

  async reconcilePaymentAttemptSystem(attemptId: string) {
    let observation = await this.observeAttempt(attemptId);
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { status: true, nextReconcileAt: true },
    });
    if (
      observation === "PROCESSING" &&
      attempt.status === "PROCESSING" &&
      attempt.nextReconcileAt &&
      attempt.nextReconcileAt <= new Date()
    )
      observation = "UNKNOWN";
    return this.applyAttemptObservation(
      attemptId,
      observation,
      "PAYMENT_RECONCILIATION",
    );
  }

  async applyPaymentObservationSystem(
    attemptId: string,
    observation: PaymentObservation,
  ) {
    return this.applyAttemptObservation(
      attemptId,
      observation,
      "PAYMENT_RECONCILIATION",
    );
  }

  async adminPayments() {
    const payments = await this.prisma.payment.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { attempts: { orderBy: { sequence: "desc" }, take: 1 } },
    });
    return payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      failureCode: payment.lastFailureCode,
      updatedAt: payment.updatedAt,
      attempt: payment.attempts[0]
        ? {
            id: payment.attempts[0].id,
            status: payment.attempts[0].status,
            method: payment.attempts[0].method,
            failureCode: payment.attempts[0].failureCode,
            createdAt: payment.attempts[0].createdAt,
          }
        : null,
    }));
  }

  async adminPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        attempts: { orderBy: { sequence: "desc" } },
        refunds: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!payment) throw new NotFoundException();
    return {
      id: payment.id,
      status: payment.status,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      failureCode: payment.lastFailureCode,
      nextReconcileAt: payment.nextReconcileAt,
      attempts: payment.attempts.map((attempt) => ({
        id: attempt.id,
        sequence: attempt.sequence,
        method: attempt.method,
        status: attempt.status,
        failureCode: attempt.failureCode,
        providerFingerprint:
          attempt.providerReferenceDigest?.slice(0, 12) ?? null,
        createdAt: attempt.createdAt,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
      })),
      refunds: payment.refunds.map((refund) => ({
        kind: refund.kind,
        status: refund.status,
        amountMinor: refund.amountMinor.toString(),
        createdAt: refund.createdAt,
      })),
    };
  }

  async reconcilePaymentAttempt(
    actorId: string,
    paymentId: string,
    attemptId: string,
    key: string | undefined,
  ) {
    const ownedAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { id: attemptId, paymentId },
      select: { id: true },
    });
    if (!ownedAttempt) throw new NotFoundException();
    const prepared = this.idempotency.prepare(
      `payment:reconcile:${attemptId}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const applied = await this.reconcilePaymentAttemptSystem(attemptId);
    const response = {
      attemptStatus: applied.attemptStatus,
      paymentStatus: applied.paymentStatus,
      orderStatus: applied.orderStatus,
    };
    await this.prisma.idempotencyRecord.create({
      data: this.idempotency.data(prepared, response),
    });
    await this.audit.record("PAYMENT_RECONCILED", actorId, "payment", {
      status: applied.paymentStatus,
      operation: "RECONCILE",
    });
    return response;
  }

  private async observeAttempt(attemptId: string): Promise<PaymentObservation> {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { payment: true },
    });
    if (!attempt) throw new NotFoundException();
    const reference = attempt.providerReferenceCiphertext
      ? revealProviderReference(
          attempt.providerReferenceCiphertext,
          this.env.paymentReferenceKey,
        )
      : attempt.payment.providerPaymentReference;
    if (!reference)
      throw new ConflictException({ code: "PAYMENT_REFERENCE_UNAVAILABLE" });
    const observed = await this.payments.status(reference, {
      idempotencyKey: digest(`status:${attempt.merchantReference}`),
      correlationId: attempt.id,
    });
    if (
      observed.amountMinor !== attempt.amountMinor ||
      observed.currency !== attempt.currency
    )
      return "UNKNOWN";
    return observed.status === "PENDING"
      ? "PROCESSING"
      : observed.status === "REFUNDED"
        ? "SUCCEEDED"
        : observed.status;
  }

  private async applyAttemptObservation(
    attemptId: string,
    observation: PaymentObservation,
    source: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.paymentAttempt.findUnique({
        where: { id: attemptId },
        include: { payment: { include: { order: true } } },
      });
      if (!initial) throw new NotFoundException();
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${initial.payment.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${initial.paymentId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${attemptId}::uuid FOR UPDATE`;
      const attempt = await tx.paymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { payment: { include: { order: true } } },
      });
      const transition = paymentTransition(attempt.status, observation);
      if (
        attempt.status === transition.attempt &&
        attempt.payment.status === transition.payment
      )
        return {
          attemptStatus: attempt.status,
          paymentStatus: attempt.payment.status,
          orderStatus: attempt.payment.order.status,
          duplicate: true,
        };
      const changedAttempt = await tx.paymentAttempt.update({
        where: { id: attempt.id, version: attempt.version },
        data: {
          status: transition.attempt,
          failureCode:
            transition.attempt === "FAILED"
              ? "PROVIDER_DECLINED"
              : transition.attempt === "UNKNOWN"
                ? "RECONCILIATION_REQUIRED"
                : null,
          nextReconcileAt: transition.attempt === "UNKNOWN" ? new Date() : null,
          completedAt: ["SUCCEEDED", "FAILED"].includes(transition.attempt)
            ? new Date()
            : null,
          cancelledAt: transition.attempt === "CANCELLED" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      const changedPayment = await tx.payment.update({
        where: { id: attempt.paymentId, version: attempt.payment.version },
        data: {
          status: transition.payment,
          lastFailureCode:
            transition.payment === "FAILED"
              ? "PROVIDER_DECLINED"
              : transition.payment === "UNKNOWN"
                ? "RECONCILIATION_REQUIRED"
                : null,
          nextReconcileAt: transition.payment === "UNKNOWN" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      let orderStatus = attempt.payment.order.status;
      if (
        transition.payment === "SUCCEEDED" &&
        attempt.payment.order.status === "AWAITING_PAYMENT"
      ) {
        const changedOrder = await tx.order.update({
          where: {
            id: attempt.payment.orderId,
            version: attempt.payment.order.version,
            status: "AWAITING_PAYMENT",
          },
          data: { status: "PAID", version: { increment: 1 } },
        });
        orderStatus = changedOrder.status;
      }
      const eventType =
        transition.payment === "SUCCEEDED"
          ? "PAYMENT_SUCCEEDED"
          : transition.payment === "FAILED"
            ? "PAYMENT_FAILED"
            : transition.payment === "CANCELLED"
              ? "PAYMENT_CANCELLED"
              : transition.payment === "UNKNOWN"
                ? "PAYMENT_RECONCILIATION_REQUIRED"
                : "PAYMENT_PROCESSING";
      const event =
        eventType === "PAYMENT_RECONCILIATION_REQUIRED"
          ? outbox(
              "payment_attempt",
              changedAttempt.id,
              changedAttempt.version,
              eventType,
            )
          : outbox(
              "payment",
              changedPayment.id,
              changedPayment.version,
              eventType,
            );
      await tx.outboxEvent.upsert({
        where: { dedupKey: event.dedupKey },
        create: {
          ...event,
          payload: {
            aggregateId: event.aggregateId,
            aggregateVersion: event.aggregateVersion,
            source,
          },
        },
        update: {},
      });
      return {
        attemptStatus: changedAttempt.status,
        paymentStatus: changedPayment.status,
        orderStatus,
        duplicate: false,
      };
    });
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
    const paymentReference = this.referenceForPayment(order.payment);
    if (!paymentReference)
      throw new ConflictException({ code: "PAYMENT_REFERENCE_MISSING" });
    const provider = await this.payments.refund(
      paymentReference,
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
      include: {
        payment: {
          include: { attempts: { orderBy: { sequence: "desc" }, take: 1 } },
        },
      },
    });
    if (!operation) throw new NotFoundException();
    const paymentReference = this.referenceForPayment(operation.payment);
    if (!paymentReference)
      throw new ConflictException({ code: "PAYMENT_REFERENCE_MISSING" });
    const provider = operation.providerRefundReference
      ? { reference: operation.providerRefundReference }
      : await this.payments.refund(paymentReference, operation.amountMinor, {
          idempotencyKey: operation.triggerDedupKey,
          correlationId: operation.paymentId,
        });
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

  private referenceForPayment(payment: {
    providerPaymentReference: string | null;
    attempts?: Array<{ providerReferenceCiphertext: string | null }>;
  }): string | null {
    const protectedReference = payment.attempts?.find(
      (attempt) => attempt.providerReferenceCiphertext,
    )?.providerReferenceCiphertext;
    return protectedReference
      ? revealProviderReference(
          protectedReference,
          this.env.paymentReferenceKey,
        )
      : payment.providerPaymentReference;
  }

  private async storeRepeatedCallback(
    tx: Prisma.TransactionClient,
    input: PaymentCallbackDto,
    payloadHash: string,
    payment: { status: PaymentStatus; order: { status: string } },
    paymentAttemptId?: string,
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
        paymentAttemptId,
        payloadHash,
        eventType: input.outcome,
        disposition: "DUPLICATE",
        resultCode: "DUPLICATE_EVENT",
        result,
      },
    });
    return result;
  }
}
