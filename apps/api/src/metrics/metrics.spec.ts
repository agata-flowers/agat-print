import { describe, expect, it } from "vitest";
import { MetricsService, validateMetricLabelNames } from "./metrics.service";
describe("metric label policy", () => {
  it("allows bounded labels", () =>
    expect(() =>
      validateMetricLabelNames(["route", "method", "status_code"]),
    ).not.toThrow());
  it.each(["user_id", "phone", "requestId", "url", "filename"])(
    "rejects %s",
    (label) => expect(() => validateMetricLabelNames([label])).toThrow(),
  );
  it("does not expose default runtime labels outside the allowlist", async () => {
    const output = await new MetricsService().registry.metrics();
    expect(output).not.toContain("nodejs_");
    expect(output).not.toContain("process_");
  });
});
