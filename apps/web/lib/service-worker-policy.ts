export const NEVER_CACHE_PATHS = [
  "/api/",
  "/auth/",
  "/profile",
  "/partner",
  "/admin",
  "/uploads/",
  "/layouts/",
  "/orders/",
  "/payments/",
  "/tariffs/",
  "/documents/",
] as const;
export const isSensitiveRequest = (url: URL): boolean =>
  NEVER_CACHE_PATHS.some((path) => url.pathname.startsWith(path)) ||
  url.searchParams.has("X-Amz-Signature") ||
  url.searchParams.has("signature") ||
  url.searchParams.has("token");
