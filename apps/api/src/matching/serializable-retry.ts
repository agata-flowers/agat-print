import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export function isRetryableTransactionConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !error.meta) return false;
  const databaseCode = (error.meta as { code?: unknown }).code;
  return databaseCode === "40001" || databaseCode === "40P01";
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 20;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) throw error;
      if (attempt === maxAttempts - 1)
        throw new ConflictException({ code: "CONCURRENT_CHANGE" });
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw new ConflictException({ code: "CONCURRENT_CHANGE" });
}
