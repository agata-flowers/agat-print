import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PartnerStatus } from "@prisma/client";
import { IdempotencyService } from "../commerce/idempotency.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import type {
  CreatePartnerDto,
  ModeratePartnerDto,
  UpdateBranchProfileDto,
  UpdatePartnerProfileDto,
} from "./dto";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class PartnersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async create(ownerId: string, input: CreatePartnerDto) {
    return this.createWithStatus(ownerId, input, "PENDING");
  }

  async createDraft(
    ownerId: string,
    key: string | undefined,
    input: CreatePartnerDto,
  ) {
    const prepared = this.idempotency.prepare(
      `partner:${ownerId}:draft`,
      key,
      input,
    );
    const replay = await this.idempotency.replay(prepared);
    if (replay) return replay;
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (prior) return this.idempotency.assertCompatible(prior, prepared);
      if (await tx.partner.findUnique({ where: { ownerId } }))
        throw new ConflictException({ code: "PARTNER_EXISTS" });
      const partner = await tx.partner.create({
        data: {
          ownerId,
          displayName: input.displayName,
          status: "DRAFT",
          branches: {
            create: { name: input.branchName, district: input.district },
          },
        },
        include: { branches: true },
      });
      const response = this.partnerView(partner);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          response as Prisma.InputJsonValue,
        ),
      });
      await this.auditTx(
        tx,
        ownerId,
        "PARTNER_DRAFT_CREATED",
        "DRAFT",
        "CREATE",
      );
      return response;
    });
  }

  async submit(ownerId: string, key: string | undefined) {
    return this.partnerMutation(
      ownerId,
      "submit",
      key,
      {},
      async (tx, partner) => {
        if (partner.status !== "DRAFT")
          throw new ConflictException({ code: "PARTNER_NOT_DRAFT" });
        return tx.partner.update({
          where: { id: partner.id },
          data: { status: "PENDING" },
          include: { branches: true },
        });
      },
    );
  }

  async updateProfile(
    ownerId: string,
    key: string | undefined,
    input: UpdatePartnerProfileDto,
  ) {
    const encrypted = input.operationalContact
      ? this.encrypt(input.operationalContact)
      : {};
    return this.partnerMutation(ownerId, "profile", key, input, (tx, partner) =>
      tx.partner.update({
        where: { id: partner.id },
        data: {
          displayName: input.displayName,
          publicDescription: input.publicDescription,
          publicContact: input.publicContact,
          ...encrypted,
        },
        include: { branches: true },
      }),
    );
  }

  async updateBranch(
    ownerId: string,
    branchId: string,
    key: string | undefined,
    input: UpdateBranchProfileDto,
  ) {
    const prepared = this.idempotency.prepare(
      `partner:${ownerId}:branch:${branchId}:profile`,
      key,
      input,
    );
    const replay = await this.idempotency.replay(prepared);
    if (replay) return replay;
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({ where: { ownerId } });
      if (
        !partner ||
        !["ACTIVE", "APPROVED", "SUSPENDED"].includes(partner.status)
      )
        throw new ForbiddenException();
      const branch = await tx.branch.findFirst({
        where: { id: branchId, partnerId: partner.id },
      });
      if (!branch) throw new NotFoundException();
      const updated = await tx.branch.update({
        where: { id: branch.id },
        data: {
          name: input.name,
          publicDescription: input.publicDescription,
          timezone: input.timezone,
          latitude: input.latitude,
          longitude: input.longitude,
          serviceRadiusMeters: input.serviceRadiusMeters,
          acceptingOrders: input.acceptingOrders,
        },
      });
      const response = this.branchView(updated);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          response as Prisma.InputJsonValue,
        ),
      });
      await this.auditTx(
        tx,
        ownerId,
        "BRANCH_PROFILE_CHANGED",
        updated.acceptingOrders ? "ACCEPTING" : "PAUSED",
        "UPDATE",
      );
      return response;
    });
  }

  async own(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
      include: {
        branches: {
          include: {
            capabilityVersions: { where: { status: "ACTIVE" }, take: 1 },
            operationalVersions: { where: { status: "ACTIVE" }, take: 1 },
            catalogVersions: {
              where: { status: "ACTIVE" },
              take: 1,
              include: { items: true },
            },
            capacityVersions: { where: { status: "ACTIVE" }, take: 1 },
            availabilityExceptions: {
              where: { cancelledAt: null, endsAt: { gt: new Date() } },
              orderBy: { startsAt: "asc" },
              take: 20,
            },
          },
        },
      },
    });
    if (!partner) throw new NotFoundException();
    return this.partnerView(partner);
  }

  async list() {
    const partners = await this.prisma.partner.findMany({
      include: {
        branches: {
          include: {
            capabilityVersions: { where: { status: "ACTIVE" }, take: 1 },
            operationalVersions: { where: { status: "ACTIVE" }, take: 1 },
            catalogVersions: {
              where: { status: "ACTIVE" },
              take: 1,
              include: { items: true },
            },
            capacityVersions: { where: { status: "ACTIVE" }, take: 1 },
            availabilityExceptions: {
              where: { cancelledAt: null, endsAt: { gt: new Date() } },
              orderBy: { startsAt: "asc" },
              take: 20,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return partners.map((partner) => this.partnerView(partner));
  }

  async moderate(
    partnerId: string,
    actorId: string,
    key: string | undefined,
    input: ModeratePartnerDto,
  ) {
    const prepared = this.idempotency.prepare(
      `admin:partner:${partnerId}:moderate`,
      key,
      input,
    );
    const replay = await this.idempotency.replay(prepared);
    if (replay) return replay;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Partner" WHERE id = ${partnerId}::uuid FOR UPDATE`;
      const existing = await tx.partner.findUnique({
        where: { id: partnerId },
      });
      if (!existing) throw new NotFoundException();
      if (existing.status === "CLOSED")
        throw new ConflictException({ code: "PARTNER_CLOSED" });
      if (
        input.status === "ACTIVE" &&
        !["PENDING", "SUSPENDED", "APPROVED"].includes(existing.status)
      )
        throw new ConflictException({ code: "INVALID_PARTNER_TRANSITION" });
      const updated = await tx.partner.update({
        where: { id: partnerId },
        data: {
          status: input.status,
          approvedAt:
            input.status === "ACTIVE" ? new Date() : existing.approvedAt,
        },
        include: { branches: true },
      });
      if (input.status === "ACTIVE")
        await tx.userRole.upsert({
          where: { userId_role: { userId: existing.ownerId, role: "PARTNER" } },
          create: { userId: existing.ownerId, role: "PARTNER" },
          update: {},
        });
      const response = this.partnerView(updated);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          response as Prisma.InputJsonValue,
        ),
      });
      await this.auditTx(
        tx,
        actorId,
        "PARTNER_LIFECYCLE_CHANGED",
        input.status,
        "MODERATE",
      );
      await tx.outboxEvent.create({
        data: {
          aggregateType: "partner",
          aggregateId: partnerId,
          aggregateVersion: Math.floor(updated.updatedAt.getTime() / 1000),
          eventType: `PARTNER_${input.status}`,
          dedupKey: digest(
            `${partnerId}:${updated.updatedAt.toISOString()}:${input.status}`,
          ),
          payload: { aggregateId: partnerId, status: input.status },
        },
      });
      return response;
    });
  }

  async approve(partnerId: string, actorId: string) {
    const existing = await this.prisma.partner.findUnique({
      where: { id: partnerId },
    });
    if (!existing) throw new NotFoundException();
    if (["APPROVED", "ACTIVE"].includes(existing.status))
      return this.ownById(partnerId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.update({
        where: { id: partnerId },
        data: { status: "APPROVED", approvedAt: new Date() },
        include: { branches: true },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId: existing.ownerId, role: "PARTNER" } },
        create: { userId: existing.ownerId, role: "PARTNER" },
        update: {},
      });
      await this.auditTx(
        tx,
        actorId,
        "partner.approved",
        "APPROVED",
        "APPROVE",
      );
      return partner;
    });
    return this.partnerView(updated);
  }

  private async ownById(id: string) {
    return this.partnerView(
      await this.prisma.partner.findUniqueOrThrow({
        where: { id },
        include: { branches: true },
      }),
    );
  }

  private async createWithStatus(
    ownerId: string,
    input: CreatePartnerDto,
    status: PartnerStatus,
  ) {
    if (await this.prisma.partner.findUnique({ where: { ownerId } }))
      throw new ConflictException("Partner application already exists");
    const partner = await this.prisma.$transaction(async (tx) => {
      const created = await tx.partner.create({
        data: {
          ownerId,
          displayName: input.displayName,
          status,
          branches: {
            create: { name: input.branchName, district: input.district },
          },
        },
        include: { branches: true },
      });
      await this.auditTx(tx, ownerId, "partner.applied", status, "APPLY");
      return created;
    });
    return this.partnerView(partner);
  }

  private async partnerMutation(
    ownerId: string,
    operation: string,
    key: string | undefined,
    input: unknown,
    execute: (
      tx: Prisma.TransactionClient,
      partner: { id: string; status: PartnerStatus },
    ) => Promise<Prisma.PartnerGetPayload<{ include: { branches: true } }>>,
  ) {
    const prepared = this.idempotency.prepare(
      `partner:${ownerId}:${operation}`,
      key,
      input,
    );
    const replay = await this.idempotency.replay(prepared);
    if (replay) return replay;
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({ where: { ownerId } });
      if (!partner) throw new NotFoundException();
      const updated = await execute(tx, partner);
      const response = this.partnerView(updated);
      await tx.idempotencyRecord.create({
        data: this.idempotency.data(
          prepared,
          response as Prisma.InputJsonValue,
        ),
      });
      await this.auditTx(
        tx,
        ownerId,
        "PARTNER_PROFILE_CHANGED",
        updated.status,
        operation.toUpperCase(),
      );
      return response;
    });
  }

  private async auditTx(
    tx: Prisma.TransactionClient,
    actorId: string,
    eventType: string,
    status: string,
    operation: string,
  ) {
    await tx.auditEvent.create({
      data: {
        actorId,
        eventType,
        targetType: "partner-network",
        metadata: { status, operation },
      },
    });
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(this.env.deliveryDataKey, "base64"),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(value.normalize("NFKC"), "utf8"),
      cipher.final(),
    ]);
    return {
      operationalContactCiphertext: ciphertext.toString("base64"),
      operationalContactIv: iv.toString("base64"),
      operationalContactAuthTag: cipher.getAuthTag().toString("base64"),
    };
  }

  private partnerView(partner: Record<string, unknown>) {
    const value = partner as {
      id: string;
      displayName: string;
      publicDescription: string | null;
      publicContact: string | null;
      operationalContactCiphertext: string | null;
      status: PartnerStatus;
      approvedAt: Date | null;
      createdAt: Date;
      branches?: Array<Record<string, unknown>>;
    };
    return {
      id: value.id,
      displayName: value.displayName,
      publicDescription: value.publicDescription,
      publicContact: value.publicContact,
      hasOperationalContact: Boolean(value.operationalContactCiphertext),
      status: value.status,
      approvedAt: value.approvedAt,
      createdAt: value.createdAt,
      branches: value.branches?.map((branch) => this.branchView(branch)) ?? [],
    };
  }

  private branchView(branch: Record<string, unknown>) {
    const value = branch as {
      id: string;
      name: string;
      city: string;
      district: string | null;
      publicDescription?: string | null;
      timezone?: string;
      latitude?: { toString(): string } | number;
      longitude?: { toString(): string } | number;
      serviceRadiusMeters?: number;
      acceptingOrders?: boolean;
      active: boolean;
      capabilityVersions?: unknown[];
      operationalVersions?: unknown[];
      catalogVersions?: unknown[];
      capacityVersions?: unknown[];
      availabilityExceptions?: unknown[];
    };
    return {
      id: value.id,
      name: value.name,
      city: value.city,
      district: value.district,
      publicDescription: value.publicDescription ?? null,
      timezone: value.timezone ?? "Asia/Tashkent",
      latitude: value.latitude?.toString() ?? null,
      longitude: value.longitude?.toString() ?? null,
      serviceRadiusMeters: value.serviceRadiusMeters ?? 25000,
      acceptingOrders: value.acceptingOrders ?? true,
      active: value.active,
      capability: value.capabilityVersions?.[0] ?? null,
      operational: value.operationalVersions?.[0] ?? null,
      catalog: value.catalogVersions?.[0] ?? null,
      capacity: value.capacityVersions?.[0] ?? null,
      availability: value.availabilityExceptions ?? [],
    };
  }
}
