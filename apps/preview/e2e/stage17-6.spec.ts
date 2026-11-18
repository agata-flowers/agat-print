import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/marketplace/catalog?lang=ru");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("catalog hierarchy, suggestions, filters and buy-now flow are functional", async ({
  page,
}) => {
  const filters = page.locator(".market-filter-panel");
  await filters
    .getByLabel("Найти товар, услугу или магазин")
    .fill("Ежедневник");
  await filters.getByLabel("Категории").selectOption("stationery");
  await filters.getByLabel("Рейтинг от").selectOption("4.5");
  await filters.getByLabel("Сортировка").selectOption("rating");
  await expect(page.locator("[data-product-id]")).toHaveCount(2);
  await page
    .locator("[data-product-id]")
    .first()
    .getByRole("button", { name: /Открыть товар/ })
    .click();
  await expect(page.locator(".market-breadcrumbs")).toContainText("Товар");
  await expect(page.locator(".market-gallery-thumbs button")).toHaveCount(4);
  await expect(page.locator(".market-product-seller")).toBeVisible();
  await page.getByRole("button", { name: "Купить сейчас" }).click();
  await expect(page).toHaveURL(/\/marketplace\/cart/);
  await expect(page.locator(".market-cart-group")).toHaveCount(1);
});

test("checkout, order details and repeat order preserve local customer state", async ({
  page,
}) => {
  await page
    .locator("[data-product-id]")
    .first()
    .getByRole("button", { name: /В корзину:/ })
    .click();
  await page.getByRole("button", { name: /Корзина 1/ }).click();
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await page.getByRole("button", { name: "Подтвердить демо-заказ" }).click();
  await expect(page).toHaveURL(/\/marketplace\/account\/orders/);
  await page.getByRole("button", { name: "Детали заказа" }).click();
  await expect(page.locator(".market-order-detail")).toContainText("DEMO-0001");
  await page.getByRole("button", { name: "Повторить заказ" }).click();
  await expect(page).toHaveURL(/\/marketplace\/cart/);
  await expect(page.locator(".market-cart-group")).toHaveCount(1);
});

test("service wizard and deterministic assignment handle decline, timeout and acceptance", async ({
  page,
}) => {
  await page.goto("/marketplace/service/printing?lang=ru");
  for (const select of await page.locator(".market-field-grid select").all())
    await select.selectOption({ index: 1 });
  for (const input of await page
    .locator('.market-field-grid input:not([type="file"])')
    .all())
    await input.fill("2");
  await page.locator('.market-field-grid input[type="file"]').setInputFiles({
    name: "synthetic-stage17-6.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("synthetic document"),
  });
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page
    .getByRole("button", { name: "Подтвердить демо-заказ услуги" })
    .click();
  await page.getByRole("button", { name: "Симулировать отказ" }).click();
  await page.getByRole("button", { name: "Симулировать тайм-аут" }).click();
  await page.getByRole("button", { name: "Принять исполнителем" }).click();
  await expect(page.locator("[data-assignment-state=accepted]")).toBeVisible();
  await expect(page.locator(".market-assignment-timeline li")).toHaveCount(3);
});

test("account and seller journeys remain localized and responsive", async ({
  page,
}) => {
  await page.goto("/marketplace/seller/dashboard?lang=ru");
  await expect(page.getByText("Магазин готов к работе")).toBeVisible();
  await page.getByRole("button", { name: "Настройки магазина" }).click();
  await page.getByLabel("Название магазина").fill("AGAT PRINT Demo Studio");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Изменения сохранены локально",
  );

  await page.getByRole("button", { name: "UZ", exact: true }).click();
  await expect(page.getByText("Do‘kon nomi")).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText("Store name")).toBeVisible();

  for (const width of [1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("capture Stage 17.6 internal page screenshots", async ({
  page,
}, testInfo) => {
  test.skip(process.env.CAPTURE_STAGE176_SCREENSHOTS !== "1");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const routes = [
    ["catalog", "/marketplace/catalog?lang=ru"],
    [
      "product",
      "/marketplace/product/premium-notebook--agat-print-tashkent?lang=ru",
    ],
    ["service", "/marketplace/service/printing?lang=ru"],
    ["account", "/marketplace/account/overview?lang=ru"],
    ["seller", "/marketplace/seller/dashboard?lang=ru"],
  ] as const;
  for (const [name, route] of routes) {
    await page.goto(route);
    await page.screenshot({
      path: testInfo.outputPath(`stage17-6-${name}-1440.png`),
      fullPage: false,
    });
  }
});
