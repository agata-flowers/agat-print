import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fallbackPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);
const syntheticPdf = process.env.STAGE12_PDF_FIXTURE
  ? readFileSync(process.env.STAGE12_PDF_FIXTURE)
  : fallbackPdf;

test("RU customer selects a moderated studio through the real ordering flow", async ({
  page,
}) => {
  await page.goto("/studios?lang=ru&serviceCode=DOCUMENT_PRINT");
  await expect(page.getByRole("heading", { name: "Студии" })).toBeVisible();
  await expect(page.getByText("Студия 1", { exact: true })).toBeVisible();
  await page.goto("/catalog?lang=ru");
  await page
    .getByRole("article")
    .filter({ hasText: "Печать документов" })
    .getByRole("link", { name: "Продолжить" })
    .click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel("Номер телефона").fill("+998000000139");
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByLabel("Одноразовый код").fill("000000");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByText("Выбор студии")).toBeVisible();
  await page.getByLabel(/Студия 1/).check();
  await page.getByRole("button", { name: "Сохранить выбор" }).click();
  await expect(page.getByText("Выбор студии сохранён.")).toBeVisible();
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
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(page.getByTestId("studio-preference")).toContainText("Студия 1");
  await expect(page.locator("body")).not.toContainText(
    /CAPACITY_FULL|PARTNER_OFFERED|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});

test("UZ discovery keeps automatic assignment understandable and private", async ({
  page,
}) => {
  await page.goto("/studios?lang=uz&serviceCode=DOCUMENT_PRINT");
  await expect(page.getByRole("heading", { name: "Studiyalar" })).toBeVisible();
  await expect(page.getByText("Studiya 1", { exact: true })).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(
    /branchId|partnerId|latitude|longitude|capacity|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});
