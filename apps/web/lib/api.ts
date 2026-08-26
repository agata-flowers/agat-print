const origin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
let csrfToken: string | undefined;
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
  if (!response.ok)
    throw new Error(`API request failed with ${response.status}`);
  return response;
}
