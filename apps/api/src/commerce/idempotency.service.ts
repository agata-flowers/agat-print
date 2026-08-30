import { createHash } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { IdempotencyRecord, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  prepare(scope: string, key: string | undefined, payload: unknown) {
    if (!key || key.length < 16 || key.length > 200 || /\s/.test(key))
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    return {
      scope,
      keyDigest: sha256(key),
      requestHash: sha256(canonical(payload)),
    };
  }

  async replay<T>(prepared: ReturnType<IdempotencyService["prepare"]>) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_keyDigest: {
          scope: prepared.scope,
          keyDigest: prepared.keyDigest,
        },
      },
    });
    if (!existing) return undefined;
    if (existing.requestHash !== prepared.requestHash)
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    return existing.response as T;
  }

  data(
    prepared: ReturnType<IdempotencyService["prepare"]>,
    response: Prisma.InputJsonValue,
    statusCode = 200,
  ): Prisma.IdempotencyRecordCreateInput {
    return {
      ...prepared,
      response,
      statusCode,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  assertCompatible(
    existing: IdempotencyRecord,
    prepared: ReturnType<IdempotencyService["prepare"]>,
  ) {
    if (existing.requestHash !== prepared.requestHash)
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    return existing.response;
  }
}
