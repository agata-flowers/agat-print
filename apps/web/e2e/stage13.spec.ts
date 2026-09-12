import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fallbackPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);
const syntheticPdf = process.env.STAGE13_PDF_FIXTURE
  ? readFileSync(process.env.STAGE13_PDF_FIXTURE)
  : fallbackPdf;

async function reachApprovedLayout(
  page: Page,
  locale: "ru" | "uz",
  phone: string,
) {
  await page.goto(`/catalog?lang=${locale}`);
  const continueLabel = locale === "ru" ? "Продолжить" : "Davom etish";
  await page
    .getByRole("article")
    .first()
    .getByRole("link", { name: continueLabel })
    .click();
  await page.getByRole("button", { name: continueLabel }).click();
  await page
    .getByLabel(locale === "ru" ? "Номер телефона" : "Telefon raqami")
    .fill(phone);
  await page
    .getByRole("button", {
      name: locale === "ru" ? "Получить код" : "Kod olish",
    })
    .click();
  await page
    .getByLabel(locale === "ru" ? "Одноразовый код" : "Bir martalik kod")
    .fill("000000");
  await page
    .getByRole("button", { name: locale === "ru" ? "Войти" : "Kirish" })
    .click();
  await page.getByRole("button", { name: continueLabel }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPdf,
  });
  await page
    .getByRole("button", {
      name: locale === "ru" ? "Загрузить файл" : "Faylni yuklash",
    })
    .click();
  await page
    .getByRole("button", {
      name: locale === "ru" ? "Подготовить макет" : "Maketni tayyorlash",
    })
    .click({ timeout: 120_000 });
  await expect(page.locator("iframe.preview-frame")).toBeVisible({
    timeout: 120_000,
  });
  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/approve"),
  );
  await page
    .getByRole("button", {
      name: locale === "ru" ? "Подтвердить макет" : "Maketni tasdiqlash",
    })
    .click();
  const approvalResponse = await approvalResponsePromise;
  const approvalBody = (await approvalResponse.json()) as {
    code?: string;
    step?: string;
    fulfillmentRequired?: boolean;
    layout?: { approved?: boolean };
  };
  expect({
    status: approvalResponse.status(),
    code: approvalBody.code ?? null,
    step: approvalBody.step ?? null,
    fulfillmentRequired: approvalBody.fulfillmentRequired ?? null,
    layoutApproved: approvalBody.layout?.approved ?? null,
  }).toEqual({
    status: 201,
    code: null,
    step: "fulfillment",
    fulfillmentRequired: true,
    layoutApproved: true,
  });
  await expect(page.getByTestId("fulfillment-step")).toBeVisible();
}

test("RU customer commits pickup before the authoritative quote", async ({
  page,
}) => {
  await reachApprovedLayout(page, "ru", "+998000000154");
  await page.getByLabel(/Самовывоз из студии/).check();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Рассчитать цену" }).click();
  await expect(page.getByText("Итого")).toBeVisible();
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(page.getByRole("heading", { name: "Ваш заказ" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /addressCiphertext|fulfillmentTariffRuleId|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});

test("UZ customer commits zonal delivery and recovers it after reload", async ({
  page,
}) => {
  const address = "Synthetic district, building 20";
  await reachApprovedLayout(page, "uz", "+998000000155");
  await page.getByLabel(/Yetkazib berish/).check();
  await page.getByLabel("Yetkazish manzili").fill(address);
  await page.getByRole("button", { name: "Davom etish" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Narxni hisoblash" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(address);
  await page.getByRole("button", { name: "Narxni hisoblash" }).click();
  await page
    .getByRole("button", { name: "Buyurtmani rasmiylashtirish" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Buyurtmangiz" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /addressCiphertext|fulfillmentTariffRuleId|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});
