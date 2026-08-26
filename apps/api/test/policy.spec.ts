import { describe, expect, it } from "vitest";
import { CacheControlInterceptor } from "../src/common/cache-control.interceptor";

describe("sensitive response policy", () => {
  it("sets no-store and private", () => {
    const headers = new Map<string, string>();
    const interceptor = new CacheControlInterceptor();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({
          setHeader: (key: string, value: string) => headers.set(key, value),
        }),
      }),
    };
    const next = { handle: () => ({}) };
    interceptor.intercept(context as never, next as never);
    expect(headers.get("Cache-Control")).toBe("no-store, private");
  });
});
