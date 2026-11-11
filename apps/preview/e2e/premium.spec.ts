import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/premium?lang=ru");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("premium catalog supports search, favorites, details and persistent cart", async ({
  page,
}) => {
  await expect(
    page.getByText("Интерактивный демо-прототип", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Найти услугу, товар или идею…").fill("Ежедневник");
  const card = page.locator("[data-product-id]").first();
  await expect(card).toContainText("Ежедневник");
  await card.locator(".heart-button").click();
  await card.getByRole("button", { name: /В корзину:/ }).click();
  await card.getByRole("button", { name: /Подробнее:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Premium" }).click();
  await expect(page.getByRole("button", { name: "Premium" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть" })
    .click();
  await page.getByRole("button", { name: /Корзина/ }).click();
  await expect(
    page
      .locator(".premium-cart-drawer")
      .getByText("Ежедневник A5", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Корзина/ }).click();
  await expect(
    page
      .locator(".premium-cart-drawer")
      .getByText("Ежедневник A5", { exact: true }),
  ).toBeVisible();
});

test("language changes preserve authoritative demo state", async ({ page }) => {
  await page
    .locator("[data-product-id]")
    .first()
    .getByRole("button", { name: /В корзину:/ })
    .click();
  for (const language of ["UZ", "EN", "RU"]) {
    await page.getByRole("button", { name: language, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lang=${language.toLowerCase()}`));
    await expect(page.locator(".premium-actions b").last()).toHaveText("1");
  }
});

test("infinite feed appends distinct products and mobile controls remain usable", async ({
  page,
}) => {
  const products = page.locator("[data-product-id]");
  const before = await products.count();
  await page.locator(".feed-sentinel").scrollIntoViewIfNeeded();
  await expect.poll(() => products.count()).toBeGreaterThan(before);
  const ids = await products.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-product-id")),
  );
  expect(new Set(ids).size).toBe(ids.length);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".premium-mobile-nav")).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByPlaceholder("Find a service, product or idea…"),
  ).toBeVisible();
});

test("capture approved desktop and mobile review images", async ({
  page,
}, testInfo) => {
  test.skip(process.env.CAPTURE_STAGE17_SCREENSHOTS !== "1");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("stage17-premium-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/premium?lang=uz");
  await page.screenshot({
    path: testInfo.outputPath("stage17-premium-mobile.png"),
    fullPage: true,
  });
});
