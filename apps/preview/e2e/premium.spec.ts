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
      .getByText(/Ежедневник A5/)
      .first(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Корзина/ }).click();
  await expect(
    page
      .locator(".premium-cart-drawer")
      .getByText(/Ежедневник A5/)
      .first(),
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

test("services use dedicated validated order flows and never enter the product cart", async ({
  page,
}) => {
  const serviceCards = page.locator("[data-service-id]");
  await expect(serviceCards).toHaveCount(6);
  await page
    .locator('[data-service-id="printing"]')
    .getByRole("button", { name: "Оформить услугу" })
    .click();

  const wizard = page.getByRole("dialog", { name: "Распечатка документов" });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: /Продолжить/ }).click();
  await wizard.getByRole("button", { name: /Продолжить/ }).click();
  await expect(wizard.getByRole("alert")).toHaveText(
    "Заполните обязательные поля",
  );
  await wizard.locator('input[type="file"]').setInputFiles({
    name: "synthetic-document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("synthetic stage 17.1 document"),
  });
  await wizard.getByRole("button", { name: /Продолжить/ }).click();
  await expect(wizard.getByText("Проверка", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: /Подтвердить демо-заказ/ }).click();
  await expect(
    wizard.getByText("Демо-заказ создан", { exact: true }),
  ).toBeVisible();

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("agat-premium-demo-service") ?? "null"),
  );
  expect(stored).toMatchObject({ serviceId: "printing", demo: true });
  expect(stored.estimate).toBeGreaterThan(0);
  await wizard.getByRole("button", { name: "Вернуться к услугам" }).click();
  await page.getByRole("button", { name: /Корзина/ }).click();
  await expect(
    page.getByText("Корзина пока пуста", { exact: true }),
  ).toBeVisible();
});

test("all six service journeys are localized and available on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "UZ", exact: true }).click();
  await expect(page.locator("[data-service-id]")).toHaveCount(6);
  await page
    .locator('[data-service-id="id-photo"]')
    .getByRole("button", { name: "Xizmatni buyurtma qilish" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Hujjat uchun foto" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yopish" }).click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByText("Popular services", { exact: true }),
  ).toBeVisible();
});

test("premium redesign remains readable at tablet and narrow mobile widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const tabletCard = page.locator('[data-service-id="outdoor"]');
  await expect(tabletCard).toBeVisible();
  const tabletBox = await tabletCard.boundingBox();
  expect(tabletBox?.width).toBeGreaterThan(210);
  expect(tabletBox?.height).toBeGreaterThan(100);

  await page.setViewportSize({ width: 360, height: 800 });
  const mobileCard = page.locator('[data-service-id="outdoor"]');
  await expect(mobileCard).toBeVisible();
  const mobileBox = await mobileCard.boundingBox();
  expect(mobileBox?.width).toBeGreaterThan(210);
  expect(mobileBox?.height).toBeGreaterThan(100);
  await expect(page.locator(".premium-mobile-nav")).toBeVisible();
});

test("approved marketplace grid uses six desktop columns without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cards = page
    .locator(".product-shelf")
    .first()
    .locator("[data-product-id]");
  await expect(cards).toHaveCount(6);
  const tops = await cards.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  await expect(page.locator(".premium-sidebar")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  for (const width of [1024, 768, 430, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("marketplace navigation and cart controls have meaningful reactions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Каталог", exact: true }).click();
  await expect(page.locator("#premium-services")).toBeInViewport();

  await page
    .locator(".premium-category-grid")
    .getByRole("button", { name: /Фотоподарки/ })
    .click();
  await expect(page.locator("#premium-catalog")).toBeInViewport();
  const filteredCard = page.locator("[data-product-id]").first();
  await filteredCard.getByRole("button", { name: /В корзину:/ }).click();
  await page.getByRole("button", { name: /Корзина/ }).click();

  const drawer = page.locator(".premium-cart-drawer");
  await drawer.getByRole("button", { name: "+", exact: true }).click();
  await expect(drawer.locator(".quantity-control span")).toHaveText("2");
  await drawer.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(
    drawer.getByText("Корзина пока пуста", { exact: true }),
  ).toBeVisible();
});

test("capture approved desktop and mobile review images", async ({
  page,
}, testInfo) => {
  test.skip(process.env.CAPTURE_STAGE17_SCREENSHOTS !== "1");
  await page.setViewportSize({ width: 1674, height: 940 });
  await page.screenshot({
    path: testInfo.outputPath("stage17-3-approved-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/premium?lang=uz");
  await page.screenshot({
    path: testInfo.outputPath("stage17-3-approved-mobile.png"),
    fullPage: false,
  });
});
