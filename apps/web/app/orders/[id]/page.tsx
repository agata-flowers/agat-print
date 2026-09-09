"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../../../lib/api";
import { customerError, useCustomerLocale } from "../../../lib/customer-i18n";

type OrderView = {
  id: string;
  status: string;
  price: null | { totalMinor: string; currency: string; quantity: number };
  payment: null | { status: string };
  fulfillment: null | {
    mode: "PICKUP" | "DELIVERY";
    status: string;
    deliveryStatus: string | null;
  };
  studioPreference: null | {
    mode: "AUTO_ASSIGN" | "PREFERRED_STUDIO";
    fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE" | "STRICT_PREFERENCE";
    studio: null | { slug: string; titleRu: string; titleUz: string };
  };
};
type DisputeView = {
  id: string;
  category: string;
  status: string;
  resolution: null | { type: string };
};
type Timeline = {
  current: string;
  events: Array<{ presentation: string; at: string }>;
};

const copy = {
  ru: {
    title: "Ваш заказ",
    total: "Итого",
    payment: "Оплатить",
    payWaiting: "Ожидаем подтверждение платёжного провайдера.",
    payFailed: "Оплата не завершена. Повторите попытку — заказ сохранён.",
    pickup: "Самовывоз",
    delivery: "Доставка",
    address: "Адрес доставки",
    savePin:
      "Сохраните PIN до получения заказа. Он показывается только один раз.",
    issue: "Сообщить о проблеме",
    open: "Отправить обращение",
    cancel: "Отменить обращение",
    unavailable: "Заказ недоступен или принадлежит другому пользователю.",
    timeline: "Ход заказа",
    studio: "Выбранная студия",
    automaticStudio: "Студия будет подобрана автоматически",
  },
  uz: {
    title: "Buyurtmangiz",
    total: "Jami",
    payment: "To‘lash",
    payWaiting: "To‘lov provayderi tasdig‘ini kutyapmiz.",
    payFailed:
      "To‘lov yakunlanmadi. Qayta urinib ko‘ring — buyurtma saqlangan.",
    pickup: "Olib ketish",
    delivery: "Yetkazib berish",
    address: "Yetkazib berish manzili",
    savePin:
      "Buyurtmani olishgacha PIN-kodni saqlang. U faqat bir marta ko‘rsatiladi.",
    issue: "Muammo haqida xabar berish",
    open: "Murojaat yuborish",
    cancel: "Murojaatni bekor qilish",
    unavailable: "Buyurtma mavjud emas yoki boshqa foydalanuvchiga tegishli.",
    timeline: "Buyurtma jarayoni",
    studio: "Tanlangan studiya",
    automaticStudio: "Studiya avtomatik tanlanadi",
  },
} as const;
const stateLabels = {
  ru: {
    AWAITING_PAYMENT: "Ожидает оплаты",
    PAID: "Оплата получена",
    MATCHING: "Ищем подходящую студию",
    PARTNER_OFFERED: "Студии предложен заказ",
    PARTNER_ACCEPTED: "Студия приняла заказ",
    IN_PRODUCTION: "Заказ печатается",
    READY: "Готов к получению",
    AWAITING_PICKUP: "Ожидает выдачи",
    COURIER_ASSIGNED: "Курьер назначен",
    IN_DELIVERY: "В доставке",
    COMPLETED: "Завершён",
    DELIVERY_FAILED: "Доставка не состоялась",
    DISPUTED: "Обращение рассматривается",
    REPRINT: "Назначена повторная печать",
    REFUND_PENDING: "Возврат подтверждается",
    PARTIALLY_REFUNDED: "Частичный возврат выполнен",
    REFUNDED: "Возврат выполнен",
  },
  uz: {
    AWAITING_PAYMENT: "To‘lov kutilmoqda",
    PAID: "To‘lov qabul qilindi",
    MATCHING: "Mos studiya qidirilmoqda",
    PARTNER_OFFERED: "Buyurtma studiyaga taklif qilindi",
    PARTNER_ACCEPTED: "Studiya buyurtmani qabul qildi",
    IN_PRODUCTION: "Buyurtma chop etilmoqda",
    READY: "Olishga tayyor",
    AWAITING_PICKUP: "Berishni kutmoqda",
    COURIER_ASSIGNED: "Kuryer tayinlandi",
    IN_DELIVERY: "Yetkazilmoqda",
    COMPLETED: "Bajarildi",
    DELIVERY_FAILED: "Yetkazib berilmadi",
    DISPUTED: "Murojaat ko‘rib chiqilmoqda",
    REPRINT: "Qayta chop etish belgilandi",
    REFUND_PENDING: "Qaytarish tasdiqlanmoqda",
    PARTIALLY_REFUNDED: "Qisman qaytarildi",
    REFUNDED: "Pul qaytarildi",
  },
} as const;
const timelineLabels = {
  ru: {
    created: "Заказ создан",
    paid: "Оплата получена",
    partner_assigned: "Студия назначена",
    production: "Печать началась",
    ready: "Заказ готов",
    delivery: "Заказ передан в доставку",
    completed: "Заказ завершён",
    delivery_failed: "Доставка не состоялась",
    refunded: "Возврат выполнен",
    updated: "Статус обновлён",
  },
  uz: {
    created: "Buyurtma yaratildi",
    paid: "To‘lov qabul qilindi",
    partner_assigned: "Studiya tayinlandi",
    production: "Chop etish boshlandi",
    ready: "Buyurtma tayyor",
    delivery: "Buyurtma yetkazishga berildi",
    completed: "Buyurtma bajarildi",
    delivery_failed: "Yetkazib berilmadi",
    refunded: "Pul qaytarildi",
    updated: "Holat yangilandi",
  },
} as const;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useCustomerLocale();
  const text = copy[locale];
  const [order, setOrder] = useState<OrderView>();
  const [timeline, setTimeline] = useState<Timeline>();
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState("");
  const [completionPin, setCompletionPin] = useState("");
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [category, setCategory] = useState("PRINT_QUALITY");
  const load = useCallback(async () => {
    try {
      const [orderResponse, disputeResponse, timelineResponse] =
        await Promise.all([
          apiRequest(`/orders/${id}`),
          apiRequest(`/orders/${id}/disputes`),
          apiRequest(`/orders/${id}/timeline`),
        ]);
      setOrder((await orderResponse.json()) as OrderView);
      setDisputes(
        ((await disputeResponse.json()) as { disputes: DisputeView[] })
          .disputes,
      );
      setTimeline((await timelineResponse.json()) as Timeline);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}&lang=${locale}`,
        );
        return;
      }
      setMessage(text.unavailable);
    }
  }, [id, text.unavailable]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  const pay = async () => {
    try {
      const response = await apiRequest(`/orders/${id}/payment`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ simulateOutcome: "SUCCESS" }),
      });
      const started = (await response.json()) as {
        mockCallback?: unknown;
        mockSignature?: string;
      };
      if (started.mockCallback && started.mockSignature)
        await apiRequest("/payments/mock/callback", {
          method: "POST",
          headers: { "X-Provider-Signature": started.mockSignature },
          body: JSON.stringify(started.mockCallback),
        });
      else
        await apiRequest(`/orders/${id}/payment/confirm`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: "{}",
        });
      setMessage(text.payWaiting);
      await load();
    } catch {
      setMessage(text.payFailed);
    }
  };
  const requestFulfillment = async (mode: "PICKUP" | "DELIVERY") => {
    try {
      const response = await apiRequest(`/orders/${id}/fulfillment`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          mode,
          ...(mode === "DELIVERY" ? { deliveryAddress: address } : {}),
        }),
      });
      setCompletionPin(
        ((await response.json()) as { completionPin: string }).completionPin,
      );
      setMessage(text.savePin);
      await load();
    } catch {
      setMessage(customerError("REQUEST_FAILED", locale));
    }
  };
  const openDispute = async () => {
    try {
      await apiRequest(`/orders/${id}/disputes`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ category }),
      });
      await load();
    } catch {
      setMessage(customerError("REQUEST_FAILED", locale));
    }
  };
  const cancelDispute = async (disputeId: string) => {
    try {
      await apiRequest(`/disputes/${disputeId}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      await load();
    } catch {
      setMessage(customerError("REQUEST_FAILED", locale));
    }
  };
  const state = order?.status
    ? (stateLabels[locale][order.status as keyof typeof stateLabels.ru] ??
      (locale === "uz" ? "Jarayonda" : "В работе"))
    : locale === "uz"
      ? "Yuklanmoqda"
      : "Загрузка";
  return (
    <main className="narrow">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.title}</h1>
      <section className="panel draft-flow" data-testid="order-status">
        <h2>{state}</h2>
        {order?.studioPreference?.mode === "PREFERRED_STUDIO" &&
        order.studioPreference.studio ? (
          <p data-testid="studio-preference">
            {text.studio}:{" "}
            {locale === "uz"
              ? order.studioPreference.studio.titleUz
              : order.studioPreference.studio.titleRu}
          </p>
        ) : (
          order?.studioPreference && (
            <p data-testid="studio-preference">{text.automaticStudio}</p>
          )
        )}
        {order?.price && (
          <p>
            <strong>
              {text.total}: {order.price.totalMinor} {order.price.currency}
            </strong>{" "}
            · {order.price.quantity}
          </p>
        )}
        {order?.status === "AWAITING_PAYMENT" && (
          <button className="button primary" onClick={pay}>
            {text.payment}
          </button>
        )}
        {order?.status === "READY" && (
          <div className="auth-form">
            <h2>{locale === "uz" ? "Buyurtmani olish" : "Получение заказа"}</h2>
            <button
              className="button secondary"
              onClick={() => requestFulfillment("PICKUP")}
            >
              {text.pickup}
            </button>
            <label>
              {text.address}
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="street-address"
                minLength={8}
                maxLength={500}
              />
            </label>
            <button
              className="button primary"
              disabled={address.length < 8}
              onClick={() => requestFulfillment("DELIVERY")}
            >
              {text.delivery}
            </button>
          </div>
        )}
        {completionPin && (
          <p className="pin" role="status">
            PIN: <strong>{completionPin}</strong>
          </p>
        )}
        <section>
          <h2>{text.timeline}</h2>
          <ol className="journey">
            {timeline?.events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                {timelineLabels[locale][
                  event.presentation as keyof typeof timelineLabels.ru
                ] ?? timelineLabels[locale].updated}
                <small>
                  {new Date(event.at).toLocaleString(
                    locale === "uz" ? "uz-UZ" : "ru-RU",
                  )}
                </small>
              </li>
            ))}
          </ol>
        </section>
        {["COMPLETED", "DELIVERY_FAILED"].includes(order?.status ?? "") &&
          !disputes.some((item) =>
            ["OPEN", "PARTNER_RESPONDED"].includes(item.status),
          ) && (
            <div className="auth-form">
              <h2>{text.issue}</h2>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="PRINT_QUALITY">
                  {locale === "uz" ? "Chop etish sifati" : "Качество печати"}
                </option>
                <option value="WRONG_OUTPUT">
                  {locale === "uz" ? "Noto‘g‘ri natija" : "Неверный результат"}
                </option>
                <option value="DAMAGED">
                  {locale === "uz" ? "Shikastlangan" : "Повреждение"}
                </option>
                <option value="MISSING_ITEMS">
                  {locale === "uz" ? "Yetishmaydi" : "Не хватает материалов"}
                </option>
                <option value="DELIVERY_FAILURE">
                  {locale === "uz" ? "Yetkazish muammosi" : "Проблема доставки"}
                </option>
              </select>
              <button className="button secondary" onClick={openDispute}>
                {text.open}
              </button>
            </div>
          )}
        {disputes
          .filter((item) => item.status === "OPEN")
          .map((item) => (
            <button
              className="button secondary"
              key={item.id}
              onClick={() => cancelDispute(item.id)}
            >
              {text.cancel}
            </button>
          ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
