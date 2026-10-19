import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile customer navigation policy", () => {
  it("keeps the mandatory language switcher available on narrow screens", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const mobileRules = css.slice(css.indexOf("@media (max-width: 700px)"));

    expect(mobileRules).toContain(".topbar nav");
    expect(mobileRules).not.toMatch(
      /\.topbar\s*>\s*\.language\s*\{[^}]*display:\s*none/s,
    );
  });
});
