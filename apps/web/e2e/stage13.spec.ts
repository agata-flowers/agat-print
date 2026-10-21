import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fallbackPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);
const syntheticPdf = process.env.STAGE13_PDF_FIXTURE
  ? readFileSync(process.env.STAGE13_PDF_FIXTURE)
  : fallbackPdf;
const stage14Payment = process.env.RUN_STAGE14_BROWSER_E2E === "1";

type PaymentEvidence = {
  operation: "start" | "confirm";
  status: number;
  code: string | null;
  paymentStatus: string | null;
};

async function payAndCaptureEvidence(
  page: Page,
  buttonName: string,
): Promise<PaymentEvidence[]> {
  const evidence: PaymentEvidence[] = [];
  const capture = async (
    response: Awaited<ReturnType<Page["waitForResponse"]>>,
  ) => {
    const pathname = new URL(response.url()).pathname;
    if (
      response.request().method() !== "POST" ||
      !/\/api\/v1\/orders\/[^/]+\/payment(?:\/confirm)?$/.test(pathname)
    )
      return;
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: { code?: string };
      paymentStatus?: string;
    };
    evidence.push({
      operation: pathname.endsWith("/confirm") ? "confirm" : "start",
      status: response.status(),
      code: body.code ?? body.message?.code ?? null,
      paymentStatus: body.paymentStatus ?? null,
    });
  };
  page.on("response", capture);
  try {
    await page.getByRole("button", { name: buttonName }).click();
    await expect
      .poll(() => evidence.length, {
        message: `Expected payment start and confirm responses; safe evidence: ${JSON.stringify(evidence)}`,
        timeout: 30_000,
      })
      .toBe(2);
    expect(evidence).toEqual([
      {
        operation: "start",
        status: 201,
        code: null,
        paymentStatus: "PROCESSING",
      },
      {
        operation: "confirm",
        status: 201,
        code: null,
        paymentStatus: "SUCCEEDED",
      },
    ]);
    return evidence;
  } finally {
    page.off("response", capture);
  }
}

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
  const otpResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/otp/request",
  );
  await page
    .getByRole("button", {
      name: locale === "ru" ? "Получить код" : "Kod olish",
    })
    .click();
  const otpResponse = await otpResponsePromise;
  const otpBody = (await otpResponse.json().catch(() => ({}))) as {
    accepted?: boolean;
    code?: string;
    message?: { code?: string };
  };
  expect({
    status: otpResponse.status(),
    accepted: otpBody.accepted ?? null,
    code: otpBody.code ?? otpBody.message?.code ?? null,
  }).toEqual({ status: 202, accepted: true, code: null });
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
  if (stage14Payment) {
    await payAndCaptureEvidence(page, "Оплатить");
    await expect(page.getByText("Оплата подтверждена.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Оплата получена" }),
    ).toBeVisible();
    const orderPath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "UZ", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "To‘lov qabul qilindi" }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(orderPath);
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Payment received" }),
    ).toBeVisible();
    await expect(page.getByText("Your order")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(orderPath);
    await page.getByRole("link", { name: "RU", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Оплата получена" }),
    ).toBeVisible();
  }
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
  if (stage14Payment) {
    await page.reload();
    await payAndCaptureEvidence(page, "To‘lash");
    await expect(page.getByText("To‘lov tasdiqlandi.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "To‘lov qabul qilindi" }),
    ).toBeVisible();
  }
  await expect(page.locator("body")).not.toContainText(
    /addressCiphertext|fulfillmentTariffRuleId|[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  );
});
