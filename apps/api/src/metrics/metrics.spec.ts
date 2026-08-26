import { describe, expect, it } from "vitest";
import { validateMetricLabelNames } from "./metrics.service";
describe("metric label policy", () => {
  it("allows bounded labels", () =>
    expect(() =>
      validateMetricLabelNames(["route", "method", "status_code"]),
    ).not.toThrow());
  it.each(["user_id", "phone", "requestId", "url", "filename"])(
    "rejects %s",
    (label) => expect(() => validateMetricLabelNames([label])).toThrow(),
  );
});
