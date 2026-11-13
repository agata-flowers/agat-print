import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/marketplace?lang=ru");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("catalog search, filters, product offers and grouped checkout work", async ({
  page,
}) => {
  await expect(page.getByText("Демо-прототип", { exact: false })).toBeVisible();
  await page.getByLabel("Найти товар, услугу или магазин").fill("Ежедневник");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace\/catalog\?q=/);
  await expect(page.locator("[data-product-id]")).toHaveCount(1);
  await page
    .locator("[data-product-id]")
    .first()
    .getByRole("button", { name: /Открыть товар/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ежедневник Premium A5" }),
  ).toBeVisible();
  await expect(page.locator(".market-offers article")).toHaveCount(2);
  await page
    .locator(".market-offers article")
    .first()
    .getByRole("button", { name: "В корзину" })
    .click();
  await page.getByRole("button", { name: /Корзина 1/ }).click();
  await expect(page.locator(".market-cart-group")).toHaveCount(1);
  await page
    .locator(".market-quantity")
    .getByRole("button", { name: "+" })
    .click();
  await expect(page.locator(".market-quantity span")).toHaveText("2");
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await page.getByRole("button", { name: "Подтвердить демо-заказ" }).click();
  await expect(page).toHaveURL(/\/marketplace\/account\/orders/);
  await expect(page.getByText("DEMO-0001")).toBeVisible();
});

test("favorites, locale switching and buyer state remain local and durable", async ({
  page,
}) => {
  const first = page.locator("[data-product-id]").first();
  await first.locator(".market-heart").click();
  await first.getByRole("button", { name: /В корзину:/ }).click();
  await page.getByRole("button", { name: "UZ", exact: true }).click();
  await expect(page).toHaveURL(/lang=uz/);
  await expect(page.getByRole("button", { name: /Savat 1/ })).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("button", { name: /Favorites 1/ })).toBeVisible();
  await page.getByRole("button", { name: /Favorites 1/ }).click();
  await expect(page.locator("[data-product-id]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("[data-product-id]")).toHaveCount(1);
});

test("services keep a dedicated validated multi-step checkout", async ({
  page,
}) => {
  await page.goto("/marketplace/service/printing?lang=ru");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Заполните обязательные поля",
  );

  for (const select of await page.locator(".market-field-grid select").all())
    await select.selectOption({ index: 1 });
  for (const input of await page
    .locator('.market-field-grid input:not([type="file"])')
    .all())
    await input.fill("2");
  const file = page.locator('.market-field-grid input[type="file"]');
  if (await file.count())
    await file.setInputFiles({
      name: "synthetic-stage17-4.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic demo document"),
    });
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.locator(".market-contractor-grid button").first().click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByText("Предварительная стоимость")).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить демо-заказ услуги" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Демонстрационный заказ услуги создан" }),
  ).toBeVisible();
});

test("seller edits and adds local assortment reflected in catalog", async ({
  page,
}) => {
  await page.goto("/marketplace/seller/products?lang=ru");
  const editor = page.locator(".market-seller-products form");
  await editor.getByLabel("Цена").fill("77777");
  await editor.getByLabel("Остаток").fill("8");
  await editor.getByRole("button", { name: "Обновить карточку" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Изменения сохранены локально",
  );

  const add = page.locator(".market-seller-add");
  await add.getByLabel("Название товара").fill("Тестовый премиум-блокнот");
  await add.getByRole("button", { name: "Добавить товар" }).click();
  await expect(page.getByText("Тестовый премиум-блокнот")).toBeVisible();
  await page.getByRole("button", { name: "Товары", exact: true }).click();
  await page
    .getByPlaceholder("Найти товар, услугу или магазин")
    .fill("Тестовый премиум-блокнот");
  await expect(page.getByText("Тестовый премиум-блокнот")).toBeVisible();
});

test("history, automatic feed and responsive layouts preserve navigation", async ({
  page,
}) => {
  const feedProducts = page.locator("[data-market-feed] [data-product-id]");
  const before = await feedProducts.count();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => feedProducts.count()).toBeGreaterThan(before);
  const first = page.locator("[data-product-id]").first();
  await first.getByRole("button", { name: /Открыть товар/ }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/marketplace\?lang=ru/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);

  for (const width of [1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("capture Stage 17.4 desktop and mobile review screenshots", async ({
  page,
}, testInfo) => {
  test.skip(process.env.CAPTURE_STAGE174_SCREENSHOTS !== "1");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("stage17-4-marketplace-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/marketplace?lang=uz");
  await page.screenshot({
    path: testInfo.outputPath("stage17-4-marketplace-mobile.png"),
    fullPage: false,
  });
});
