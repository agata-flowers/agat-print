import { describe, expect, it } from "vitest";
import { readPreviewState, writePreviewState } from "./preview-state";

describe("preview URL state", () => {
  it("uses bounded defaults for untrusted query values", () => {
    expect(readPreviewState("?lang=x&surface=raw&step=PAID")).toEqual({
      locale: "ru",
      surface: "customer",
      step: "home",
    });
  });

  it("round-trips locale, surface, and visual step", () => {
    const expected = {
      locale: "uz" as const,
      surface: "mobile" as const,
      step: "checkout" as const,
    };
    expect(readPreviewState(writePreviewState(expected))).toEqual(expected);
  });
});
