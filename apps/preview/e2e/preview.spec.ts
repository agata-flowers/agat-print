import { expect, test } from "@playwright/test";

const languages = [
  { code: "uz", label: "O‘zbekcha", title: "G‘oyadan tayyor bosmagacha" },
  { code: "ru", label: "Русский", title: "От идеи до готовой печати" },
  { code: "en", label: "English", title: "From idea to finished print" },
] as const;

test("customer journey is complete and language switching changes presentation only", async ({
  page,
}) => {
  await page.goto("/?lang=ru&surface=customer&step=home");
  await expect(
    page.getByText("синтетические данные", { exact: false }),
  ).toBeVisible();

  for (const language of languages) {
    await page.getByLabel(language.label).click();
    await expect(page).toHaveURL(new RegExp(`lang=${language.code}`));
    await expect(
      page.getByRole("heading", { name: new RegExp(language.title) }),
    ).toBeVisible();
    await expect(page).toHaveURL(/step=home/);
  }

  await page.getByLabel("Русский").click();
  await page.getByRole("button", { name: "Начать заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите услугу" }),
  ).toBeVisible();
  const expectedSteps = [
    "Загрузите файл",
    "Настройте параметры печати",
    "Проверьте макет",
    "Корзина",
    "Проверьте заказ",
    "Заказ принят",
  ];
  for (const label of expectedSteps) {
    await page.getByRole("button", { name: /^Продолжить/ }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(label) }).first(),
    ).toBeVisible();
  }
});

test("mobile and studio previews render at bounded browser viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=uz&surface=mobile&step=home");
  await expect(page.locator(".phone-frame")).toBeVisible();
  await expect(
    page.getByText("Bu xavfsiz vizual namoyish", { exact: false }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?lang=en&surface=studio&step=home");
  await expect(
    page.getByRole("heading", { name: "Production today" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send to print" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Virtual spool", { exact: false }).first(),
  ).toBeVisible();
});

test("preview has no production mutation transport", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method()))
      requests.push(request.url());
  });
  await page.goto("/?lang=en&surface=customer&step=checkout");
  await page
    .getByRole("button", { name: /^Continue/ })
    .last()
    .click();
  await expect(page).toHaveURL(/step=status/);
  expect(requests).toEqual([]);
});
