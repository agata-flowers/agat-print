const STATIC_CACHE = "agat-static-v1";
const SHELL_CACHE = "agat-shell-v1";
const NEVER_CACHE = [
  "/api/",
  "/auth/",
  "/profile",
  "/partner",
  "/admin",
  "/uploads/",
  "/documents/",
];
const sensitive = (url) =>
  NEVER_CACHE.some((path) => url.pathname.startsWith(path)) ||
  url.searchParams.has("X-Amz-Signature") ||
  url.searchParams.has("signature") ||
  url.searchParams.has("token");
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || sensitive(url)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(
        async (cache) =>
          (await cache.match(event.request)) ??
          fetch(event.request).then((response) => {
            if (response.ok) void cache.put(event.request, response.clone());
            return response;
          }),
      ),
    );
    return;
  }
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then((response) => {
        if (
          response.ok &&
          response.headers.get("Cache-Control")?.includes("public")
        )
          void cache.put(event.request, response.clone());
        return response;
      });
      return cached ?? network;
    }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data === "CLEAR_USER_CACHES")
    event.waitUntil(caches.delete(SHELL_CACHE));
});
