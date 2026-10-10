import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.RUN_STAGE15_BROWSER_E2E === "1";
test.skip(!enabled, "Stage 15 browser gate is opt-in");

const copy = {
  ru: {
    phone: "Номер телефона",
    getCode: "Получить код",
    otp: "Одноразовый код",
    signIn: "Войти",
    continue: "Продолжить",
    quote: "Рассчитать общую цену",
    checkout: "Оформить один заказ",
    pay: "Оплатить",
  },
  uz: {
    phone: "Telefon raqami",
    getCode: "Kod olish",
    otp: "Bir martalik kod",
    signIn: "Kirish",
    continue: "Davom etish",
    quote: "Umumiy narxni hisoblash",
    checkout: "Bitta buyurtma qilish",
    pay: "To‘lash",
  },
  en: {
    phone: "Phone number",
    getCode: "Get code",
    otp: "One-time code",
    signIn: "Sign in",
    continue: "Continue",
    quote: "Calculate total",
    checkout: "Place one order",
    pay: "Pay",
  },
} as const;

async function login(page: Page, locale: keyof typeof copy) {
  const text = copy[locale];
  await page.goto(
    `/login?next=${encodeURIComponent(`/basket?lang=${locale}`)}&lang=${locale}`,
  );
  await page.getByLabel(text.phone).fill("+998000001501");
  await page.getByRole("button", { name: text.getCode }).click();
  await page.getByLabel(text.otp).fill("000000");
  await page.getByRole("button", { name: text.signIn }).click();
  await expect(page).toHaveURL(new RegExp(`/basket\\?lang=${locale}`));
}

async function checkout(
  page: Page,
  locale: keyof typeof copy,
  delivery: boolean,
) {
  const text = copy[locale];
  await login(page, locale);
  await expect(page.getByTestId("basket-item")).toHaveCount(2);
  if (delivery) {
    await page
      .getByLabel(
        locale === "uz"
          ? "Yetkazib berish"
          : locale === "en"
            ? "Delivery"
            : "Доставка",
      )
      .check();
    await page
      .locator('input[autocomplete="street-address"]')
      .fill("Synthetic district, building 15");
  }
  await page.getByRole("button", { name: text.continue }).click();
  await page.getByRole("button", { name: text.quote }).click();
  const total = await page.locator("section.quote strong").textContent();
  expect(total).toMatch(/^\d+ UZS$/);
  await page.getByRole("button", { name: text.checkout }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+/);
  await page.getByRole("button", { name: text.pay }).click();
  await expect(
    page.getByText(
      locale === "uz"
        ? "To‘lov tasdiqlandi."
        : locale === "en"
          ? "Payment confirmed."
          : "Оплата подтверждена.",
    ),
  ).toBeVisible();
}

test("RU pickup multi-item purchase succeeds on first attempt", async ({
  page,
}) => {
  await checkout(page, "ru", false);
});

test("UZ delivery basket recovers and checks out on first attempt", async ({
  page,
}) => {
  await checkout(page, "uz", true);
});

test("EN basket preserves authoritative state through uz/ru/en switching", async ({
  page,
}) => {
  await login(page, "en");
  await expect(page.getByTestId("basket-item")).toHaveCount(2);
  await page.getByRole("button", { name: copy.en.continue }).click();
  await page.getByRole("button", { name: copy.en.quote }).click();
  const total = await page.locator("section.quote strong").textContent();
  for (const locale of ["UZ", "RU", "EN", "RU", "EN"] as const) {
    await page.getByRole("link", { name: locale, exact: true }).click();
    await expect(page.getByTestId("basket-item")).toHaveCount(2);
    await expect(page.locator("section.quote strong")).toHaveText(total!);
  }
  await page.getByRole("button", { name: copy.en.checkout }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+/);
  await page.getByRole("button", { name: copy.en.pay }).click();
  await expect(page.getByText("Payment confirmed.")).toBeVisible();
});
