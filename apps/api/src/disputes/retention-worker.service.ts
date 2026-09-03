import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PrivateObjectStorageService } from "../uploads/private-object-storage.service";
import {
  digest,
  event,
  holdExpiry,
  orderObjectKeys,
  retentionLock,
  terminalStatuses,
} from "./domain";

@Injectable()
export class RetentionWorkerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async run(now = new Date()) {
    await this.reconcile();
    await this.applyDue(now);
    await this.retryTombstones(now);
  }

  async reconcile() {
    let cursor: string | undefined;
    for (;;) {
      const orders = await this.prisma.order.findMany({
        orderBy: { id: "asc" },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      if (!orders.length) break;
      for (const row of orders) await this.reconcileOrder(row.id);
      cursor = orders.at(-1)!.id;
    }
  }

  async reconcileOrder(orderId: string) {
    await this.prisma.$transaction(
      async (tx) => {
        await retentionLock(tx);
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { legalHolds: true },
        });
        const keys = await orderObjectKeys(tx, orderId);
        const refs = await tx.permanentObjectReference.findMany({
          where: { objectKey: { in: keys }, deletedAt: null },
        });
        if (
          order.legalHolds.some((h) => !h.releasedAt) ||
          !(terminalStatuses as readonly string[]).includes(order.status)
        ) {
          await tx.permanentObjectReference.updateMany({
            where: { objectKey: { in: keys }, deletedAt: null },
            data: { expiresAt: holdExpiry },
          });
          await tx.retentionSchedule.updateMany({
            where: { orderId, status: "ACTIVE" },
            data: { status: "HELD" },
          });
          return;
        }
        const policy = await tx.retentionPolicy.findFirstOrThrow({
          where: { active: true },
        });
        const terminalAt = new Date(
          Math.max(
            order.updatedAt.getTime(),
            ...order.legalHolds.map((h) => h.releasedAt?.getTime() ?? 0),
          ),
        );
        const existing = await tx.retentionSchedule.findUnique({
          where: {
            orderId_terminalVersion: {
              orderId,
              terminalVersion: order.version,
            },
          },
        });
        if (existing?.status === "ACTIVE" || existing?.status === "COMPLETED")
          return;
        await tx.retentionSchedule.updateMany({
          where: { orderId, status: { in: ["ACTIVE", "HELD"] } },
          data: { status: "SUPERSEDED" },
        });
        const schedule = await tx.retentionSchedule.upsert({
          where: {
            orderId_terminalVersion: {
              orderId,
              terminalVersion: order.version,
            },
          },
          create: {
            orderId,
            policyId: policy.id,
            terminalVersion: order.version,
            terminalAt,
          },
          update: { status: "ACTIVE", terminalAt },
        });
        const owners = await tx.order.findMany({
          where: { layoutId: order.layoutId },
          include: { legalHolds: { where: { releasedAt: null } } },
        });
        const protectedElsewhere = owners.some(
          (o) =>
            o.id !== orderId &&
            (o.legalHolds.length ||
              !(terminalStatuses as readonly string[]).includes(o.status)),
        );
        const latestTerminal = Math.max(
          terminalAt.getTime(),
          ...owners.map((o) => o.updatedAt.getTime()),
        );
        for (const ref of refs) {
          const days =
            ref.retentionClass === "ORIGINAL"
              ? policy.originalDays
              : policy.derivativeDays;
          const expiresAt = new Date(latestTerminal + days * 86400000);
          await tx.retentionScheduleObject.upsert({
            where: {
              scheduleId_objectKey: {
                scheduleId: schedule.id,
                objectKey: ref.objectKey,
              },
            },
            create: {
              scheduleId: schedule.id,
              objectKey: ref.objectKey,
              expiresAt,
            },
            update: { expiresAt },
          });
          await tx.permanentObjectReference.update({
            where: { objectKey: ref.objectKey },
            data: { expiresAt: protectedElsewhere ? holdExpiry : expiresAt },
          });
        }
        await tx.outboxEvent.upsert({
          where: { dedupKey: digest("retention:" + schedule.id) },
          create: {
            ...event("retention", schedule.id, 0, "RETENTION_SCHEDULED"),
            dedupKey: digest("retention:" + schedule.id),
          },
          update: {},
        });
      },
      { timeout: 15000 },
    );
  }

  async applyDue(now = new Date()) {
    const due = await this.prisma.retentionScheduleObject.findMany({
      where: {
        expiresAt: { lte: now },
        object: { deletedAt: null, expiresAt: { lte: now } },
        schedule: { status: "ACTIVE" },
      },
      take: 100,
    });
    for (const item of due) {
      await this.prisma.$transaction(async (tx) => {
        await retentionLock(tx);
        const current = await tx.retentionScheduleObject.findUniqueOrThrow({
          where: {
            scheduleId_objectKey: {
              scheduleId: item.scheduleId,
              objectKey: item.objectKey,
            },
          },
          include: { object: true, schedule: { include: { order: true } } },
        });
        if (
          current.object.deletedAt ||
          current.object.expiresAt > now ||
          current.schedule.status !== "ACTIVE"
        )
          return;
        const owners = await tx.order.findMany({
          where: { layoutId: current.schedule.order.layoutId },
          include: { legalHolds: { where: { releasedAt: null } } },
        });
        if (
          owners.some(
            (o) =>
              o.legalHolds.length ||
              !(terminalStatuses as readonly string[]).includes(o.status),
          )
        )
          return;
        await tx.retentionTombstone.upsert({
          where: { objectKey: item.objectKey },
          create: { objectKey: item.objectKey, reason: "RETENTION_EXPIRED" },
          update: {},
        });
        await tx.permanentObjectReference.update({
          where: { objectKey: item.objectKey },
          data: { deletedAt: now },
        });
        await tx.inboxOperation.upsert({
          where: { dedupKey: digest("retention-delete:" + item.objectKey) },
          create: {
            dedupKey: digest("retention-delete:" + item.objectKey),
            operation: "RETENTION_DELETE_INTENT",
          },
          update: {},
        });
      });
    }
  }

  // Tombstones, not schedule rows, drive retries after a storage crash.
  async retryTombstones(now = new Date()) {
    const pending = await this.prisma.retentionTombstone.findMany({
      where: {
        applyStatus: "PENDING",
        attempts: { lt: 5 },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      take: 100,
    });
    for (const tombstone of pending) {
      const leaseUntil = new Date(now.getTime() + 120000);
      const claimed = await this.prisma.retentionTombstone.updateMany({
        where: {
          objectKey: tombstone.objectKey,
          applyStatus: "PENDING",
          attempts: tombstone.attempts,
          leaseUntil: tombstone.leaseUntil,
        },
        data: { attempts: { increment: 1 }, leaseUntil },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.storage.remove(tombstone.objectKey);
        await this.prisma.retentionTombstone.updateMany({
          where: { objectKey: tombstone.objectKey, leaseUntil },
          data: {
            applyStatus: "APPLIED",
            appliedAt: new Date(),
            leaseUntil: null,
            lastErrorCode: null,
          },
        });
      } catch {
        await this.prisma.retentionTombstone.updateMany({
          where: { objectKey: tombstone.objectKey, leaseUntil },
          data: {
            leaseUntil: null,
            lastErrorCode:
              tombstone.attempts + 1 >= 5
                ? "MANUAL_REVIEW_REQUIRED"
                : "STORAGE_UNAVAILABLE",
          },
        });
      }
    }
    const schedules = await this.prisma.retentionSchedule.findMany({
      where: {
        status: "ACTIVE",
        objects: { none: { object: { deletedAt: null } } },
      },
      select: { id: true },
    });
    await this.prisma.retentionSchedule.updateMany({
      where: { id: { in: schedules.map((s) => s.id) }, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: now },
    });
  }
}
