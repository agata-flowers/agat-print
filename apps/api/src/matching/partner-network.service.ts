import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { IdempotencyService } from "../commerce/idempotency.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateAvailabilityDto,
  CreateCapabilityVersionDto,
  CreateCapacityVersionDto,
  CreateCatalogVersionDto,
  CreateOperationalVersionDto,
} from "./dto";

@Injectable()
export class PartnerNetworkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  capability(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: CreateCapabilityVersionDto,
  ) {
    return this.run(ownerId, branchId, "capability", key, input, async (tx) => {
      const current = await tx.branchCapabilityVersion.findFirst({
        where: { branchId, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (current)
        await tx.branchCapabilityVersion.update({
          where: { id: current.id },
          data: { status: "RETIRED", retiredAt: new Date() },
        });
      const created = await tx.branchCapabilityVersion.create({
        data: {
          branchId,
          version: (current?.version ?? 0) + 1,
          supportedFileKinds: input.supportedFileKinds,
          maxPages: input.maxPages,
          maxWidthMm: input.maxWidthMm,
          maxHeightMm: input.maxHeightMm,
          minDpi: input.minDpi,
          priority: input.priority,
          serviceCodes: input.serviceCodes ?? ["DOCUMENT_PRINT"],
          paperCodes: input.paperCodes ?? ["STANDARD"],
          colorModes: input.colorModes ?? ["COLOR", "MONOCHROME"],
          equipmentCodes: input.equipmentCodes ?? [],
          maxQuantity: input.maxQuantity ?? 1000,
          createdById: ownerId,
        },
      });
      return {
        id: created.id,
        version: created.version,
        status: created.status,
      };
    });
  }

  operational(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: CreateOperationalVersionDto,
  ) {
    if (
      input.weeklyHours.some(
        (window) => window.closesMinute <= window.opensMinute,
      )
    )
      throw new ConflictException({ code: "INVALID_OPERATING_WINDOW" });
    return this.run(
      ownerId,
      branchId,
      "operational",
      key,
      input,
      async (tx) => {
        const current = await tx.branchOperationalVersion.findFirst({
          where: { branchId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        });
        if (current)
          await tx.branchOperationalVersion.update({
            where: { id: current.id },
            data: { status: "RETIRED", retiredAt: new Date() },
          });
        const created = await tx.branchOperationalVersion.create({
          data: {
            branchId,
            version: (current?.version ?? 0) + 1,
            weeklyHours: input.weeklyHours as unknown as Prisma.InputJsonValue,
            settings: {
              pickupEnabled: input.pickupEnabled,
              printerAgentEnabled: input.printerAgentEnabled,
            },
            createdById: ownerId,
          },
        });
        return {
          id: created.id,
          version: created.version,
          status: created.status,
        };
      },
    );
  }

  catalog(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: CreateCatalogVersionDto,
  ) {
    if (
      new Set(input.items.map((item) => item.serviceCode)).size !==
      input.items.length
    )
      throw new ConflictException({ code: "DUPLICATE_SERVICE_CODE" });
    return this.run(ownerId, branchId, "catalog", key, input, async (tx) => {
      const current = await tx.branchCatalogVersion.findFirst({
        where: { branchId, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (current)
        await tx.branchCatalogVersion.update({
          where: { id: current.id },
          data: { status: "RETIRED", retiredAt: new Date() },
        });
      const created = await tx.branchCatalogVersion.create({
        data: {
          branchId,
          version: (current?.version ?? 0) + 1,
          createdById: ownerId,
          items: { create: input.items },
        },
      });
      return {
        id: created.id,
        version: created.version,
        status: created.status,
      };
    });
  }

  capacity(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: CreateCapacityVersionDto,
  ) {
    return this.run(ownerId, branchId, "capacity", key, input, async (tx) => {
      const current = await tx.branchCapacityVersion.findFirst({
        where: { branchId, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });
      if (current)
        await tx.branchCapacityVersion.update({
          where: { id: current.id },
          data: { status: "RETIRED", retiredAt: new Date() },
        });
      const created = await tx.branchCapacityVersion.create({
        data: {
          branchId,
          version: (current?.version ?? 0) + 1,
          maxConcurrentOrders: input.maxConcurrentOrders,
          createdById: ownerId,
        },
      });
      return {
        id: created.id,
        version: created.version,
        status: created.status,
        maxConcurrentOrders: created.maxConcurrentOrders,
      };
    });
  }

  availability(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: CreateAvailabilityDto,
  ) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (
      endsAt <= startsAt ||
      endsAt.getTime() - startsAt.getTime() > 90 * 24 * 60 * 60 * 1000
    )
      throw new ConflictException({ code: "INVALID_AVAILABILITY_RANGE" });
    return this.run(
      ownerId,
      branchId,
      "availability",
      key,
      input,
      async (tx) => {
        const created = await tx.branchAvailabilityException.create({
          data: {
            branchId,
            kind: input.kind,
            startsAt,
            endsAt,
            createdById: ownerId,
          },
        });
        return {
          id: created.id,
          kind: created.kind,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt.toISOString(),
        };
      },
    );
  }

  cancelAvailability(
    ownerId: string,
    branchId: string,
    availabilityId: string,
    key: string | undefined,
  ) {
    return this.run(
      ownerId,
      branchId,
      `availability:${availabilityId}:cancel`,
      key,
      {},
      async (tx) => {
        const existing = await tx.branchAvailabilityException.findFirst({
          where: { id: availabilityId, branchId },
        });
        if (!existing) throw new ForbiddenException();
        if (existing.cancelledAt)
          return { id: existing.id, status: "CANCELLED" };
        const cancelled = await tx.branchAvailabilityException.update({
          where: { id: availabilityId },
          data: { cancelledAt: new Date() },
        });
        return { id: cancelled.id, status: "CANCELLED" };
      },
    );
  }

  private async run<T extends Prisma.InputJsonObject>(
    ownerId: string,
    branchId: string,
    operation: string,
    key: string | undefined,
    input: unknown,
    execute: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const prepared = this.idempotency.prepare(
      `partner-network:${ownerId}:${branchId}:${operation}`,
      key,
      input,
    );
    const replay = await this.idempotency.replay<T>(prepared);
    if (replay) return replay;
    return this.prisma.$transaction(
      async (tx) => {
        const branch = await tx.branch.findFirst({
          where: {
            id: branchId,
            partner: {
              ownerId,
              status: { in: ["ACTIVE", "APPROVED", "SUSPENDED"] },
            },
          },
        });
        if (!branch) throw new ForbiddenException();
        await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId}::uuid FOR UPDATE`;
        const prior = await tx.idempotencyRecord.findUnique({
          where: {
            scope_keyDigest: {
              scope: prepared.scope,
              keyDigest: prepared.keyDigest,
            },
          },
        });
        if (prior)
          return this.idempotency.assertCompatible(prior, prepared) as T;
        const response = await execute(tx);
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, response),
        });
        await tx.auditEvent.create({
          data: {
            actorId: ownerId,
            eventType: "PARTNER_NETWORK_VERSION_CREATED",
            targetType: "branch-network",
            metadata: { operation: operation.toUpperCase(), status: "ACTIVE" },
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
