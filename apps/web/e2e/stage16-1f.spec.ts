import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const enabled = process.env.RUN_STAGE16_1F_BROWSER_E2E === "1";
test.skip(!enabled, "Stage 16.1F browser gate is opt-in");

const syntheticPdf = process.env.STAGE16_1F_PDF_FIXTURE
  ? readFileSync(process.env.STAGE16_1F_PDF_FIXTURE)
  : Buffer.from("%PDF-1.4\n%%EOF");

async function login(page: Page, phone: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}&lang=ru`);
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Одноразовый код").fill("000000");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace("?", "\\?")));
}

async function customerOrder(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/?lang=ru");
  await expect(
    page.getByRole("heading", { name: "Печать и фотоуслуги — онлайн" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Создать заказ" }).first().click();
  await page
    .getByRole("article")
    .filter({ hasText: "Печать документов" })
    .getByRole("link", { name: "Продолжить" })
    .click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel("Номер телефона").fill("+998000016101");
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Одноразовый код").fill("000000");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPdf,
  });
  await page.getByRole("button", { name: "Загрузить файл" }).click();
  await page
    .getByRole("button", { name: "Подготовить макет" })
    .click({ timeout: 120_000 });
  await expect(page.getByTitle("Проверьте макет")).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "Подтвердить макет" }).click();
  await page.getByRole("link", { name: "Добавить в корзину" }).click();
  await expect(page.getByTestId("basket-item")).toHaveCount(1);
  await page.getByLabel("Самовывоз из студии").check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Рассчитать общую цену" }).click();
  await expect(page.locator("section.quote strong")).toContainText("UZS");
  await page.getByRole("button", { name: "Оформить один заказ" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+/);
  await page.getByRole("button", { name: "Оплатить" }).click();
  await expect(page.getByText("Оплата подтверждена.")).toBeVisible();
  return { context, page };
}

test("real customer and studio complete the functional pilot journey", async ({
  browser,
}) => {
  const customer = await customerOrder(browser);
  const partnerContext = await browser.newContext();
  const partner = await partnerContext.newPage();
  await login(partner, "+998000016102", "/partner?lang=ru");

  await expect(async () => {
    await partner.reload();
    await expect(
      partner.getByRole("button", { name: "Принять заказ" }),
    ).toBeVisible();
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 3_000] });
  await partner.getByRole("button", { name: "Принять заказ" }).click();
  await expect(
    partner.getByText("Заказ принят", { exact: true }),
  ).toBeVisible();

  const downloadButton = partner.getByRole("button", {
    name: "Скачать для печати",
  });
  await expect(downloadButton).toBeVisible();
  const signedRequest = partner.waitForRequest((request) =>
    request.url().includes("X-Amz-Signature"),
  );
  await downloadButton.click();
  await signedRequest;
  await partner.goto("/partner?lang=ru");

  const start = partner.getByRole("button", {
    name: "Начать печать позиции",
  });
  if (await start.isVisible()) await start.click();
  await partner.getByRole("button", { name: "Позиция готова" }).click();

  await expect(async () => {
    await customer.page.reload();
    await expect(customer.page.getByTestId("order-status")).toContainText(
      "Готов к получению",
    );
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 3_000] });
  await customer.page.getByRole("button", { name: "Начать получение" }).click();
  const pinText = await customer.page.locator(".pin strong").textContent();
  expect(pinText).toMatch(/^\d{6}$/);

  await partner.goto("/partner?lang=ru");
  await partner.getByLabel("PIN передачи").fill(pinText!);
  await partner.getByRole("button", { name: "Выдать клиенту" }).click();
  await expect(partner.getByText("Передача подтверждена.")).toBeVisible();

  await customer.page.reload();
  await expect(customer.page.getByTestId("order-status")).toContainText(
    "Завершён",
  );

  const orderUrl = customer.page.url();
  for (const language of ["UZ", "EN", "RU"] as const) {
    await customer.page
      .getByRole("link", { name: language, exact: true })
      .click();
    await expect(customer.page).toHaveURL(/\/orders\/[0-9a-f-]+\?lang=/);
    await expect(customer.page.getByTestId("order-status")).toBeVisible();
  }
  expect(new URL(customer.page.url()).pathname).toBe(
    new URL(orderUrl).pathname,
  );

  await partnerContext.close();
  await customer.context.close();
});
