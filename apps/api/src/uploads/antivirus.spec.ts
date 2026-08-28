import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../config/environment";
import { AntivirusService } from "./antivirus.service";

describe("antivirus fail-closed policy", () => {
  it("rejects when the scanner cannot be reached", async () => {
    const environment = loadEnvironment({
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "x".repeat(32),
      CLAMAV_HOST: "127.0.0.1",
      CLAMAV_PORT: "1",
    });
    await expect(
      new AntivirusService(environment).scan(Buffer.from("clean")),
    ).rejects.toMatchObject({
      response: { code: "ANTIVIRUS_UNAVAILABLE" },
    });
  });
});
