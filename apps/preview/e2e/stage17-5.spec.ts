import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/marketplace?lang=ru");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("desktop home follows the approved hierarchy at all required widths", async ({
  page,
}) => {
  for (const width of [1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".market-home-sidebar")).toBeVisible();
    await expect(page.locator(".market-header-location")).toBeVisible();
    await expect(page.locator(".market-demo-bar")).toHaveCount(0);
    await expect(page.locator(".market-hero")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Онлайн-печать и фотосервисы" }),
    ).toBeVisible();
    await expect(page.locator(".market-main-service-card")).toHaveCount(7);
    await expect(page.locator(".market-home-promotion-row button")).toHaveCount(
      3,
    );
    await expect(page.locator(".market-quick-services button")).toHaveCount(8);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const heroBottom = await page
    .locator(".market-hero")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const servicesTop = await page
    .locator(".market-main-services")
    .evaluate((element) => element.getBoundingClientRect().top);
  const promotionsTop = await page
    .locator(".market-home-promotions")
    .evaluate((element) => element.getBoundingClientRect().top);
  const quickServicesTop = await page
    .locator(".market-quick-services")
    .evaluate((element) => element.getBoundingClientRect().top);
  const categoriesTop = await page
    .locator(".market-category-row")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(servicesTop).toBeGreaterThan(heroBottom);
  expect(promotionsTop).toBeGreaterThan(servicesTop);
  expect(quickServicesTop).toBeGreaterThan(promotionsTop);
  expect(categoriesTop).toBeGreaterThan(quickServicesTop);
});

test("a seller-specific listing opens a complete product page and adds directly to cart", async ({
  page,
}) => {
  await page.getByLabel("Найти товар, услугу или магазин").fill("Ежедневник");
  await page.getByLabel("Найти товар, услугу или магазин").press("Enter");
  await expect(page.locator("[data-product-id]")).toHaveCount(2);
  await page
    .locator("[data-product-id]")
    .first()
    .getByRole("button", { name: /Открыть товар/ })
    .click();
  await expect(page.locator(".market-gallery-thumbs button")).toHaveCount(4);
  await expect(page.locator(".market-product-seller")).toBeVisible();
  await expect(page.locator(".market-offers")).toHaveCount(0);
  await page
    .locator(".market-detail-actions")
    .getByRole("button", { name: "+" })
    .click();
  await page
    .locator(".market-detail-actions")
    .getByRole("button", { name: "В корзину" })
    .click();
  await page.getByRole("button", { name: /Корзина 2/ }).click();
  await expect(page.locator(".market-quantity span")).toHaveText("2");
});

test("service checkout assigns a studio automatically with decline timeout fallback and duplicate protection", async ({
  page,
}) => {
  await page.goto("/marketplace/service/printing?lang=ru");
  for (const select of await page.locator(".market-field-grid select").all())
    await select.selectOption({ index: 1 });
  for (const input of await page
    .locator('.market-field-grid input:not([type="file"])')
    .all())
    await input.fill("2");
  const file = page.locator('.market-field-grid input[type="file"]');
  if (await file.count())
    await file.setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic"),
    });
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.locator(".market-contractor-grid")).toHaveCount(0);
  await expect(
    page.getByText("Исполнитель будет выбран автоматически", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page
    .getByRole("button", { name: "Подтвердить демо-заказ услуги" })
    .click();
  await expect(page.locator("[data-assignment-state=offered]")).toBeVisible();
  await page.getByRole("button", { name: "Симулировать отказ" }).click();
  await page.getByRole("button", { name: "Симулировать тайм-аут" }).click();
  await page.getByRole("button", { name: "Принять исполнителем" }).click();
  await expect(page.locator("[data-assignment-state=accepted]")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Принять исполнителем" }),
  ).toBeDisabled();
  await expect(page.locator(".market-assignment-timeline li")).toHaveCount(3);
  await page.getByRole("button", { name: "Повторить" }).click();
  await page.getByRole("button", { name: "Нет исполнителей" }).click();
  await expect(
    page.locator("[data-assignment-state=unavailable]"),
  ).toBeVisible();
});

test("profile sections, locale state and back-to-top control remain interactive", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Кабинет/ }).click();
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  await page.getByRole("button", { name: "Товарные заказы" }).click();
  await expect(page.getByText("DEMO-0175")).toBeVisible();
  await page.getByRole("button", { name: "Заказы услуг" }).click();
  await expect(page.getByText("DEMO-SERVICE-0175")).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Service orders" }),
  ).toBeVisible();
  await page.goto("/marketplace?lang=uz");
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("button", { name: "Yuqoriga" })).toBeVisible();
  await page.getByRole("button", { name: "Yuqoriga" }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(20);
});

test("capture Stage 17.5 desktop review screenshots", async ({
  page,
}, testInfo) => {
  test.skip(process.env.CAPTURE_STAGE175_SCREENSHOTS !== "1");
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 1040 });
    await page.goto("/marketplace?lang=ru");
    await page.screenshot({
      path: testInfo.outputPath(`stage17-5-home-${width}.png`),
      fullPage: false,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.goto(
    "/marketplace/product/premium-notebook--agat-print-tashkent?lang=ru",
  );
  await page.screenshot({
    path: testInfo.outputPath("stage17-5-product-1440.png"),
    fullPage: false,
  });
  await page.goto("/marketplace/account/overview?lang=ru");
  await page.screenshot({
    path: testInfo.outputPath("stage17-5-account-1440.png"),
    fullPage: false,
  });
});
