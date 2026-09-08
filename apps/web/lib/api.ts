const origin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
let csrfToken: string | undefined;
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${origin}/api/v1/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}
export async function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await ensureCsrf();
  const response = await fetch(`${origin}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: { code?: string };
    };
    throw new ApiError(
      response.status,
      body.code ?? body.message?.code ?? "REQUEST_FAILED",
    );
  }
  return response;
}

export async function publicApiRequest(path: string): Promise<Response> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new ApiError(response.status, "REQUEST_FAILED");
  return response;
}

export async function apiUpload(path: string, file: File): Promise<Response> {
  const token = await ensureCsrf();
  const response = await fetch(`${origin}/api/v1${path}`, {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": file.type, "X-CSRF-Token": token },
    body: file,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ApiError(response.status, body.code ?? "UPLOAD_FAILED");
  }
  return response;
}
