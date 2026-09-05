import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  FiscalProvider,
  PaymentProvider,
  PayoutProvider,
} from "@agat/providers";
import { AuditService } from "../audit/audit.service";
import { IdempotencyService } from "../commerce/idempotency.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  FISCAL_PROVIDER,
  PAYMENT_PROVIDER,
  PAYOUT_PROVIDER,
} from "../providers/provider-tokens";
import type { CreateSettlementBatchDto, RunReconciliationDto } from "./dto";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const outbox = (
  aggregateType: string,
  aggregateId: string,
  version: number,
  eventType: string,
) => ({
  aggregateType,
  aggregateId,
  aggregateVersion: version,
  eventType,
  dedupKey: digest(`${aggregateType}:${aggregateId}:${version}:${eventType}`),
  payload: { aggregateId, aggregateVersion: version },
});

@Injectable()
export class FinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(FISCAL_PROVIDER) private readonly fiscal: FiscalProvider,
    @Inject(PAYOUT_PROVIDER) private readonly payouts: PayoutProvider,
  ) {}

  async materializeEvent(eventId: string) {
    const event = await this.prisma.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    if (event.eventType === "PAYMENT_SUCCEEDED")
      await this.materializePayment(event.aggregateId);
    else if (event.eventType === "REFUND_CONFIRMED")
      await this.materializeRefunds(event.aggregateId);
    else if (event.eventType === "ORDER_COMPLETED")
      await this.materializeEarning(event.aggregateId);
    return { handled: true };
  }

  private async materializePayment(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    if (
      !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)
    )
      return;
    await this.prisma.$transaction(async (tx) => {
      const operation = await tx.fiscalOperation.upsert({
        where: { dedupKey: digest(`fiscal:sale:${payment.id}`) },
        create: {
          id: randomUUID(),
          orderId: payment.orderId,
          paymentId: payment.id,
          type: "SALE",
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          dedupKey: digest(`fiscal:sale:${payment.id}`),
        },
        update: {},
      });
      await tx.outboxEvent.upsert({
        where: {
          dedupKey: digest(`fiscal:${operation.id}:0:FISCAL_SUBMIT_REQUESTED`),
        },
        create: outbox("fiscal", operation.id, 0, "FISCAL_SUBMIT_REQUESTED"),
        update: {},
      });
    });
  }

  private async materializeRefunds(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        refunds: {
          where: { status: "CONFIRMED" },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    for (const refund of payment.refunds) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id}::uuid FOR UPDATE`;
        const operation = await tx.fiscalOperation.upsert({
          where: { dedupKey: digest(`fiscal:refund:${refund.id}`) },
          create: {
            id: randomUUID(),
            orderId: payment.orderId,
            paymentId: payment.id,
            refundId: refund.id,
            type: "REFUND",
            amountMinor: refund.amountMinor,
            currency: payment.currency,
            dedupKey: digest(`fiscal:refund:${refund.id}`),
          },
          update: {},
        });
        await tx.outboxEvent.upsert({
          where: {
            dedupKey: digest(
              `fiscal:${operation.id}:0:FISCAL_SUBMIT_REQUESTED`,
            ),
          },
          create: outbox("fiscal", operation.id, 0, "FISCAL_SUBMIT_REQUESTED"),
          update: {},
        });
        const earning = await tx.partnerLedgerEntry.findFirst({
          where: { orderId: payment.orderId, type: "EARNING" },
          include: { payoutSnapshot: true },
        });
        if (!earning) return;
        const priorDebits = await tx.partnerLedgerEntry.aggregate({
          where: { orderId: payment.orderId, direction: "DEBIT" },
          _sum: { amountMinor: true },
        });
        const remaining =
          earning.payoutSnapshot.partnerPayoutMinor -
          (priorDebits._sum.amountMinor ?? 0n);
        const proportional =
          (earning.payoutSnapshot.partnerPayoutMinor * refund.amountMinor) /
          payment.amountMinor;
        const isFinalFullRefund =
          payment.status === "REFUNDED" &&
          refund.id === payment.refunds.at(-1)?.id;
        const amount = isFinalFullRefund
          ? remaining
          : proportional < remaining
            ? proportional
            : remaining;
        if (amount <= 0n) return;
        await tx.partnerLedgerEntry.upsert({
          where: { dedupKey: digest(`ledger:refund:${refund.id}`) },
          create: {
            id: randomUUID(),
            orderId: payment.orderId,
            assignmentId: earning.assignmentId,
            payoutSnapshotId: earning.payoutSnapshotId,
            refundId: refund.id,
            type: "REFUND_ADJUSTMENT",
            direction: "DEBIT",
            amountMinor: amount,
            currency: payment.currency,
            dedupKey: digest(`ledger:refund:${refund.id}`),
          },
          update: {},
        });
      });
    }
  }

  private async materializeEarning(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        payment: { select: { id: true } },
        assignments: {
          orderBy: { acceptedAt: "desc" },
          take: 1,
          include: { payoutSnapshot: true },
        },
      },
    });
    const assignment = order.assignments[0];
    if (order.status !== "COMPLETED" || !assignment) return;
    await this.prisma.partnerLedgerEntry.upsert({
      where: { dedupKey: digest(`ledger:earning:${order.id}`) },
      create: {
        id: randomUUID(),
        orderId: order.id,
        assignmentId: assignment.id,
        payoutSnapshotId: assignment.payoutSnapshotId,
        type: "EARNING",
        direction: "CREDIT",
        amountMinor: assignment.payoutSnapshot.partnerPayoutMinor,
        currency: assignment.payoutSnapshot.currency,
        dedupKey: digest(`ledger:earning:${order.id}`),
      },
      update: {},
    });
    // Event workers run concurrently. Re-materializing confirmed refunds after
    // the earning exists makes refund-before-completion delivery order safe.
    if (order.payment) await this.materializeRefunds(order.payment.id);
  }

  async dispatchFiscal(operationId: string) {
    const claimed = await this.prisma.fiscalOperation.updateMany({
      where: {
        id: operationId,
        attempts: { lt: 5 },
        status: { in: ["PENDING", "RETRY_PENDING"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      data: {
        status: "SUBMITTED",
        attempts: { increment: 1 },
        nextAttemptAt: null,
      },
    });
    const operation = await this.prisma.fiscalOperation.findUniqueOrThrow({
      where: { id: operationId },
      include: { payment: true },
    });
    if (!claimed.count) {
      if (operation.status === "CONFIRMED") return { duplicate: true };
      throw new Error("FISCAL_OPERATION_NOT_READY");
    }
    try {
      if (!operation.payment.providerPaymentReference)
        throw new Error("PAYMENT_REFERENCE_MISSING");
      const result = await this.fiscal.submit(
        {
          type: operation.type,
          orderReference: operation.orderId,
          paymentReference: operation.payment.providerPaymentReference,
          amountMinor: operation.amountMinor,
          currency: "UZS",
        },
        { idempotencyKey: operation.dedupKey, correlationId: operation.id },
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.fiscalReceipt.upsert({
          where: { fiscalOperationId: operation.id },
          create: {
            id: randomUUID(),
            fiscalOperationId: operation.id,
            providerReceiptDigest: digest(result.receiptReference),
            issuedAt: result.issuedAt,
          },
          update: {},
        });
        await tx.fiscalOperation.updateMany({
          where: { id: operation.id, status: "SUBMITTED" },
          data: {
            status: "CONFIRMED",
            providerReference: result.reference,
            confirmedAt: new Date(),
            lastErrorCode: null,
          },
        });
      });
      return { duplicate: false };
    } catch {
      await this.prisma.fiscalOperation.update({
        where: { id: operation.id },
        data:
          operation.attempts >= 5
            ? {
                status: "RECONCILIATION_REQUIRED",
                lastErrorCode: "FISCAL_RETRY_EXHAUSTED",
              }
            : {
                status: "RETRY_PENDING",
                nextAttemptAt: new Date(Date.now() + 1_000),
                lastErrorCode: "FISCAL_TEMPORARY_FAILURE",
              },
      });
      throw new Error("FISCAL_OPERATION_FAILED");
    }
  }

  async createSettlement(
    actorId: string,
    key: string | undefined,
    input: CreateSettlementBatchDto,
  ) {
    const cutoffAt = new Date(input.cutoffAt);
    if (cutoffAt > new Date())
      throw new ConflictException({ code: "INVALID_SETTLEMENT_CUTOFF" });
    const prepared = this.idempotency.prepare(
      "finance:settlement:create",
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(915009)`;
        const insideReplay = await tx.idempotencyRecord.findUnique({
          where: {
            scope_keyDigest: {
              scope: prepared.scope,
              keyDigest: prepared.keyDigest,
            },
          },
        });
        if (insideReplay)
          return this.idempotency.assertCompatible(insideReplay, prepared) as {
            id: string;
            status: string;
            totalMinor: string;
            currency: string;
          };
        const entries = await tx.partnerLedgerEntry.findMany({
          where: {
            createdAt: { lte: cutoffAt },
            settlementItem: null,
            order: {
              payment: {
                status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
                refunds: {
                  none: { status: "CONFIRMED", ledgerEntry: null },
                },
              },
              disputes: {
                none: { status: { in: ["OPEN", "PARTNER_RESPONDED"] } },
              },
              productionCycles: { none: { status: { not: "COMPLETED" } } },
              legalHolds: { none: { releasedAt: null } },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          include: { assignment: { select: { partnerId: true } } },
        });
        const byPartner = new Map<string, typeof entries>();
        for (const entry of entries) {
          const partnerEntries =
            byPartner.get(entry.assignment.partnerId) ?? [];
          partnerEntries.push(entry);
          byPartner.set(entry.assignment.partnerId, partnerEntries);
        }
        const eligible = [...byPartner.entries()]
          .map(([partnerId, partnerEntries]) => ({
            partnerId,
            entries: partnerEntries,
            totalMinor: partnerEntries.reduce(
              (sum, entry) =>
                sum +
                (entry.direction === "CREDIT"
                  ? entry.amountMinor
                  : -entry.amountMinor),
              0n,
            ),
          }))
          .filter((candidate) => candidate.totalMinor > 0n)
          .sort((left, right) => left.partnerId.localeCompare(right.partnerId));
        const selected = eligible[0];
        if (!selected)
          throw new ConflictException({ code: "NO_SETTLEMENT_ENTRIES" });
        const items = selected.entries.map((entry) => ({
          ledgerEntryId: entry.id,
          amountMinor: entry.amountMinor,
        }));
        const totalMinor = selected.totalMinor;
        const batch = await tx.settlementBatch.create({
          data: {
            id: randomUUID(),
            partnerId: selected.partnerId,
            currency: "UZS",
            cutoffAt,
            totalMinor,
            dedupKey: prepared.keyDigest,
            createdById: actorId,
            items: { create: items },
          },
        });
        const response = {
          id: batch.id,
          status: batch.status,
          totalMinor: totalMinor.toString(),
          currency: batch.currency,
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, response),
        });
        await tx.outboxEvent.create({
          data: outbox("settlement", batch.id, 0, "SETTLEMENT_CREATED"),
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("SETTLEMENT_BATCH_CREATED", actorId, "settlement", {
      status: "CREATED",
      operation: "PAYOUT",
    });
    return result;
  }

  async submitSettlement(
    actorId: string,
    batchId: string,
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `finance:settlement:submit:${batchId}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const batch = await this.prisma.settlementBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException();
    if (!["CREATED", "RETRY_PENDING"].includes(batch.status))
      throw new ConflictException({ code: "INVALID_SETTLEMENT_TRANSITION" });
    let provider: { reference: string };
    try {
      provider = await this.payouts.submitBatch(
        batch.id,
        batch.partnerId,
        batch.totalMinor,
        "UZS",
        { idempotencyKey: batch.dedupKey, correlationId: batch.id },
      );
    } catch {
      await this.prisma.settlementBatch.updateMany({
        where: { id: batch.id, status: batch.status },
        data:
          batch.attempts + 1 >= 5
            ? {
                status: "RECONCILIATION_REQUIRED",
                attempts: { increment: 1 },
                lastErrorCode: "PAYOUT_RETRY_EXHAUSTED",
              }
            : {
                status: "RETRY_PENDING",
                attempts: { increment: 1 },
                nextAttemptAt: new Date(Date.now() + 1_000),
                lastErrorCode: "PAYOUT_TEMPORARY_FAILURE",
              },
      });
      throw new Error("PAYOUT_SUBMISSION_FAILED");
    }
    const response = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SettlementBatch" WHERE id = ${batch.id}::uuid FOR UPDATE`;
      const insideReplay = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (insideReplay)
        return this.idempotency.assertCompatible(insideReplay, prepared) as {
          id: string;
          status: string;
        };
      const current = await tx.settlementBatch.findUniqueOrThrow({
        where: { id: batch.id },
      });
      if (!["CREATED", "RETRY_PENDING"].includes(current.status))
        throw new ConflictException({ code: "INVALID_SETTLEMENT_TRANSITION" });
      const changed = await tx.settlementBatch.updateMany({
        where: { id: batch.id, status: current.status },
        data: {
          status: "SUBMITTED",
          providerReference: provider.reference,
          submittedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "SETTLEMENT_CONFLICT" });
      const value = { id: batch.id, status: "SUBMITTED" };
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(prepared, value),
      });
      await tx.outboxEvent.create({
        data: outbox(
          "settlement",
          batch.id,
          current.attempts + 1,
          "SETTLEMENT_SUBMITTED",
        ),
      });
      return value;
    });
    await this.audit.record(
      "SETTLEMENT_BATCH_SUBMITTED",
      actorId,
      "settlement",
      { status: "SUBMITTED", operation: "PAYOUT" },
    );
    return response;
  }

  async reconcile(
    actorId: string,
    key: string | undefined,
    input: RunReconciliationDto,
  ) {
    const prepared = this.idempotency.prepare("finance:reconcile", key, input);
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const runKeyDigest = digest(input.runReference);
    let matched = 0;
    let mismatched = 0;
    const payments = await this.prisma.payment.findMany({
      where: { providerPaymentReference: { not: null } },
      take: 500,
    });
    for (const payment of payments) {
      const observed = await this.payments.status(
        payment.providerPaymentReference!,
        {
          idempotencyKey: digest(
            `reconcile:payment:${payment.id}:${runKeyDigest}`,
          ),
          correlationId: payment.id,
        },
      );
      const expected =
        payment.status === "REFUNDED"
          ? "REFUNDED"
          : payment.status === "FAILED"
            ? "FAILED"
            : payment.status === "PENDING"
              ? "PENDING"
              : "SUCCEEDED";
      const ok =
        observed.status === expected &&
        observed.amountMinor === payment.amountMinor &&
        observed.currency === payment.currency;
      await this.recordReconciliation(
        "PAYMENT",
        payment.id,
        runKeyDigest,
        expected,
        observed.status,
        ok,
        actorId,
        ok ? null : "PAYMENT_PROVIDER_MISMATCH",
      );
      if (ok) matched += 1;
      else mismatched += 1;
    }
    const fiscal = await this.prisma.fiscalOperation.findMany({
      where: { providerReference: { not: null } },
      take: 500,
    });
    for (const operation of fiscal) {
      const observed = await this.fiscal.status(operation.providerReference!, {
        idempotencyKey: digest(
          `reconcile:fiscal:${operation.id}:${runKeyDigest}`,
        ),
        correlationId: operation.id,
      });
      const expected =
        operation.status === "CONFIRMED" ? "CONFIRMED" : "PENDING";
      const ok = observed.status === expected;
      await this.recordReconciliation(
        "FISCAL",
        operation.id,
        runKeyDigest,
        expected,
        observed.status,
        ok,
        actorId,
        ok ? null : "FISCAL_PROVIDER_MISMATCH",
      );
      if (!ok)
        await this.prisma.fiscalOperation.update({
          where: { id: operation.id },
          data: {
            status: "RECONCILIATION_REQUIRED",
            lastErrorCode: "FISCAL_PROVIDER_MISMATCH",
          },
        });
      if (ok) matched += 1;
      else mismatched += 1;
    }
    const batches = await this.prisma.settlementBatch.findMany({
      where: { providerReference: { not: null } },
      take: 500,
    });
    for (const batch of batches) {
      const observed = await this.payouts.status(batch.providerReference!, {
        idempotencyKey: digest(`reconcile:payout:${batch.id}:${runKeyDigest}`),
        correlationId: batch.id,
      });
      const providerAdvanced =
        batch.status === "SUBMITTED" && observed.status === "SETTLED";
      const expected =
        providerAdvanced || batch.status === "SETTLED" ? "SETTLED" : "PENDING";
      const ok =
        observed.status === expected &&
        observed.amountMinor === batch.totalMinor &&
        observed.currency === batch.currency;
      await this.recordReconciliation(
        "PAYOUT",
        batch.id,
        runKeyDigest,
        expected,
        observed.status,
        ok,
        actorId,
        ok ? null : "PAYOUT_PROVIDER_MISMATCH",
      );
      if (ok && providerAdvanced)
        await this.prisma.settlementBatch.updateMany({
          where: { id: batch.id, status: "SUBMITTED" },
          data: {
            status: "SETTLED",
            settledAt: new Date(),
            lastErrorCode: null,
          },
        });
      if (!ok)
        await this.prisma.settlementBatch.update({
          where: { id: batch.id },
          data: {
            status: "RECONCILIATION_REQUIRED",
            lastErrorCode: "PAYOUT_PROVIDER_MISMATCH",
          },
        });
      if (ok) matched += 1;
      else mismatched += 1;
    }
    const response = {
      status: mismatched ? "MISMATCH" : "MATCHED",
      matched,
      mismatched,
    };
    await this.prisma.idempotencyRecord.create({
      data: this.idempotency.data(prepared, response),
    });
    await this.audit.record(
      "FINANCIAL_RECONCILIATION_COMPLETED",
      actorId,
      "finance",
      { status: response.status, operation: "RECONCILE" },
    );
    return response;
  }

  private async recordReconciliation(
    kind: "PAYMENT" | "FISCAL" | "PAYOUT",
    entityId: string,
    runKeyDigest: string,
    expectedStatus: string,
    observedStatus: string,
    ok: boolean,
    actorId: string,
    detailCode: string | null,
  ) {
    await this.prisma.financialReconciliation.upsert({
      where: { kind_entityId_runKeyDigest: { kind, entityId, runKeyDigest } },
      create: {
        id: randomUUID(),
        kind,
        entityId,
        runKeyDigest,
        expectedStatus,
        observedStatus,
        status: ok ? "MATCHED" : "MISMATCH",
        detailCode,
        actorId,
      },
      update: {},
    });
  }

  async retryFiscal(
    actorId: string,
    operationId: string,
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `finance:fiscal:retry:${operationId}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const operation = await this.prisma.fiscalOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) throw new NotFoundException();
    if (
      !["RETRY_PENDING", "RECONCILIATION_REQUIRED"].includes(operation.status)
    )
      throw new ConflictException({ code: "FISCAL_RETRY_NOT_ALLOWED" });
    const response = { id: operationId, status: "PENDING" };
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalOperation.update({
        where: { id: operationId },
        data: { status: "PENDING", nextAttemptAt: null, lastErrorCode: null },
      });
      const event = outbox(
        "fiscal",
        operationId,
        operation.attempts,
        "FISCAL_SUBMIT_REQUESTED",
      );
      await tx.outboxEvent.upsert({
        where: { dedupKey: event.dedupKey },
        create: event,
        update: {},
      });
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(prepared, response),
      });
    });
    await this.audit.record("FISCAL_RETRY_REQUESTED", actorId, "fiscal", {
      status: "PENDING",
      operation: "RETRY",
    });
    return response;
  }

  async adminOverview() {
    const [fiscalOperations, batches, incidents] = await Promise.all([
      this.prisma.fiscalOperation.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          amountMinor: true,
          currency: true,
          status: true,
          attempts: true,
          createdAt: true,
        },
      }),
      this.prisma.settlementBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          sequence: true,
          totalMinor: true,
          currency: true,
          status: true,
          attempts: true,
          createdAt: true,
        },
      }),
      this.prisma.financialReconciliation.findMany({
        where: { status: "MISMATCH" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          kind: true,
          expectedStatus: true,
          observedStatus: true,
          status: true,
          detailCode: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      fiscalOperations: fiscalOperations.map((x) => ({
        ...x,
        amountMinor: x.amountMinor.toString(),
      })),
      batches: batches.map((x) => ({
        ...x,
        totalMinor: x.totalMinor.toString(),
      })),
      incidents,
    };
  }

  async partnerLedger(userId: string) {
    const entries = await this.prisma.partnerLedgerEntry.findMany({
      where: { assignment: { partner: { ownerId: userId } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        direction: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
      },
    });
    return entries.map((entry) => ({
      ...entry,
      amountMinor: entry.amountMinor.toString(),
    }));
  }
}
