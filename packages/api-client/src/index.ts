export type ApiTransport = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export class SafeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("The request could not be completed");
    this.name = "SafeApiError";
  }
}

const safeCode = (value: unknown): string =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
    ? value
    : "REQUEST_FAILED";

export const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { code?: unknown; message?: { code?: unknown } }
      | undefined;
    throw new SafeApiError(
      response.status,
      safeCode(body?.code ?? body?.message?.code),
    );
  }
  return response.json() as Promise<T>;
};

export const createApiClient = (transport: ApiTransport) => ({
  request: async <T>(path: string, init?: RequestInit): Promise<T> =>
    readJson<T>(await transport(path, init)),
});
