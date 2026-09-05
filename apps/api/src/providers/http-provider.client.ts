import type { ProviderContext } from "@agat/providers";

const referencePattern = /^[A-Za-z0-9._:-]{1,160}$/;

export class HttpProviderClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly timeoutSeconds: number,
  ) {}

  async post<T>(
    path: string,
    body: Record<string, unknown>,
    context: ProviderContext,
  ): Promise<T> {
    const response = await fetch(new URL(path, this.endpoint), {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": context.idempotencyKey,
        "x-correlation-id": context.correlationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
    });
    if (!response.ok) throw new Error("PROVIDER_REQUEST_FAILED");
    return (await response.json()) as T;
  }

  assertReference(value: unknown): string {
    if (typeof value !== "string" || !referencePattern.test(value))
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return value;
  }
}
