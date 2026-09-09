import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fallbackPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);
const syntheticPdf = process.env.STAGE11_PDF_FIXTURE
  ? readFileSync(process.env.STAGE11_PDF_FIXTURE)
  : fallbackPdf;

test("customer completes catalog to checkout and resumes the order timeline", async ({
  page,
}) => {
  await page.goto("/?lang=ru");
  await expect(
    page.getByRole("heading", { name: "Печать и фотоуслуги — онлайн" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Создать заказ" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Выберите услугу" }),
  ).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Печать документов" })
    .getByRole("link", { name: "Продолжить" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Настройте заказ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel("Номер телефона").fill("+998000000121");
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Одноразовый код").fill("000000");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(
    page.getByRole("heading", { name: "Настройте заказ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.locator("label.file-picker")).toContainText(
    "Выберите файл PDF, DOCX, JPG или PNG",
  );
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
  await page.getByRole("button", { name: "Рассчитать цену" }).click();
  await expect(page.getByText("Итого")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Оформить заказ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(page.getByRole("heading", { name: "Ваш заказ" })).toBeVisible();
  await expect(page.getByTestId("order-status")).toContainText(
    "Ожидает оплаты",
  );
  await expect(page.getByText("Заказ создан")).toBeVisible({ timeout: 30_000 });
});
