"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../../../lib/api";
import { customerError, useCustomerLocale } from "../../../lib/customer-i18n";

type OrderView = {
  id: string;
  version: number;
  status: string;
  price: null | { totalMinor: string; currency: string; quantity: number };
  payment: null | {
    status: string;
    attempt: null | {
      status: string;
      method: string;
      failureCode: string | null;
    };
  };
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
  fulfillmentSelection: null | {
    mode: "PICKUP" | "DELIVERY";
    locationCode: string;
    feeMinor: string;
    currency: string;
  };
  items: Array<{
    sequence: number;
    serviceCode: string;
    quantity: number;
    totalMinor: string;
    currency: string;
  }>;
};
type DisputeView = {
  id: string;
  category: string;
  status: string;
  resolution: null | { type: string };
  itemSequences: number[];
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
    paymentProcessing: "Проверить оплату",
    paymentSucceeded: "Оплата подтверждена.",
    paymentUnknown:
      "Результат уточняется. Новый платёж недоступен до безопасной проверки.",
    paymentCancelled: "Платёж отменён. Можно попробовать снова.",
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
    inProgress: "В работе",
    loading: "Загрузка",
    fulfillmentHeading: "Получение заказа",
    startFulfillment: "Начать получение",
    pickupCommitted: "Самовывоз из студии",
    deliveryCommitted: "Доставка по Ташкенту",
    printQuality: "Качество печати",
    wrongOutput: "Неверный результат",
    damaged: "Повреждение",
    missingItems: "Не хватает материалов",
    deliveryFailure: "Проблема доставки",
    issueScope: "Позиции обращения",
    allItems: "Весь заказ",
    item: "Позиция",
  },
  uz: {
    title: "Buyurtmangiz",
    total: "Jami",
    payment: "To‘lash",
    paymentProcessing: "To‘lovni tekshirish",
    paymentSucceeded: "To‘lov tasdiqlandi.",
    paymentUnknown:
      "Natija tekshirilmoqda. Xavfsiz tekshiruv tugamaguncha yangi to‘lov ochilmaydi.",
    paymentCancelled: "To‘lov bekor qilindi. Qayta urinishingiz mumkin.",
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
    inProgress: "Jarayonda",
    loading: "Yuklanmoqda",
    fulfillmentHeading: "Buyurtmani olish",
    startFulfillment: "Olishni boshlash",
    pickupCommitted: "Studiyadan olib ketish",
    deliveryCommitted: "Toshkent bo‘ylab yetkazib berish",
    printQuality: "Chop etish sifati",
    wrongOutput: "Noto‘g‘ri natija",
    damaged: "Shikastlangan",
    missingItems: "Yetishmaydi",
    deliveryFailure: "Yetkazish muammosi",
    issueScope: "Murojaat pozitsiyalari",
    allItems: "Butun buyurtma",
    item: "Pozitsiya",
  },
  en: {
    title: "Your order",
    total: "Total",
    payment: "Pay",
    paymentProcessing: "Check payment",
    paymentSucceeded: "Payment confirmed.",
    paymentUnknown:
      "The result is being checked. A new payment is unavailable until verification is complete.",
    paymentCancelled: "Payment cancelled. You can try again.",
    payWaiting: "Waiting for payment provider confirmation.",
    payFailed: "Payment was not completed. Try again — your order is saved.",
    pickup: "Collection",
    delivery: "Delivery",
    address: "Delivery address",
    savePin: "Keep the PIN until collection. It is shown only once.",
    issue: "Report a problem",
    open: "Submit request",
    cancel: "Cancel request",
    unavailable: "The order is unavailable or belongs to another user.",
    timeline: "Order progress",
    studio: "Selected studio",
    automaticStudio: "A studio will be selected automatically",
    inProgress: "In progress",
    loading: "Loading",
    fulfillmentHeading: "Receive order",
    startFulfillment: "Start fulfilment",
    pickupCommitted: "Collection from the studio",
    deliveryCommitted: "Delivery within Tashkent",
    printQuality: "Print quality",
    wrongOutput: "Incorrect output",
    damaged: "Damaged",
    missingItems: "Missing items",
    deliveryFailure: "Delivery problem",
    issueScope: "Issue items",
    allItems: "Whole order",
    item: "Item",
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
  en: {
    AWAITING_PAYMENT: "Awaiting payment",
    PAID: "Payment received",
    MATCHING: "Finding an eligible studio",
    PARTNER_OFFERED: "Order offered to a studio",
    PARTNER_ACCEPTED: "Studio accepted the order",
    IN_PRODUCTION: "Order is being printed",
    READY: "Ready for collection",
    AWAITING_PICKUP: "Awaiting collection",
    COURIER_ASSIGNED: "Courier assigned",
    IN_DELIVERY: "In delivery",
    COMPLETED: "Completed",
    DELIVERY_FAILED: "Delivery failed",
    DISPUTED: "Request under review",
    REPRINT: "Reprint scheduled",
    REFUND_PENDING: "Refund pending confirmation",
    PARTIALLY_REFUNDED: "Partially refunded",
    REFUNDED: "Refunded",
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
  en: {
    created: "Order created",
    paid: "Payment received",
    partner_assigned: "Studio assigned",
    production: "Printing started",
    ready: "Order ready",
    delivery: "Order handed to delivery",
    completed: "Order completed",
    delivery_failed: "Delivery failed",
    refunded: "Refund completed",
    updated: "Status updated",
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
  const [disputeItems, setDisputeItems] = useState<number[]>([]);
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
        body: JSON.stringify({
          method: "INTERNAL_MVP",
          scenario: "SUCCESS",
          expectedOrderVersion: order?.version,
        }),
      });
      await response.json();
      await confirmPayment();
      await load();
    } catch {
      setMessage(text.payFailed);
    }
  };
  const confirmPayment = async () => {
    try {
      const response = await apiRequest(`/orders/${id}/payment/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      const result = (await response.json()) as { paymentStatus: string };
      setMessage(
        result.paymentStatus === "SUCCEEDED"
          ? text.paymentSucceeded
          : result.paymentStatus === "UNKNOWN"
            ? text.paymentUnknown
            : text.payWaiting,
      );
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
  const activateCommittedFulfillment = async () => {
    try {
      const response = await apiRequest(`/orders/${id}/fulfillment/activate`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
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
        body: JSON.stringify({
          category,
          itemSequences: disputeItems.length > 0 ? disputeItems : undefined,
        }),
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
      text.inProgress)
    : text.loading;
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
        {order?.fulfillmentSelection && (
          <p data-testid="fulfillment-selection">
            {order.fulfillmentSelection.mode === "PICKUP"
              ? text.pickupCommitted
              : text.deliveryCommitted}{" "}
            · {order.fulfillmentSelection.feeMinor}{" "}
            {order.fulfillmentSelection.currency}
          </p>
        )}
        {order?.status === "AWAITING_PAYMENT" &&
          (!order.payment ||
            ["FAILED", "CANCELLED"].includes(order.payment.status)) && (
            <button className="button primary" onClick={pay}>
              {text.payment}
            </button>
          )}
        {order?.status === "AWAITING_PAYMENT" &&
          order.payment &&
          ["PENDING", "PROCESSING", "UNKNOWN"].includes(
            order.payment.status,
          ) && (
            <div className="auth-form" data-testid="payment-recovery">
              <p>
                {order.payment.status === "UNKNOWN"
                  ? text.paymentUnknown
                  : text.payWaiting}
              </p>
              <button className="button primary" onClick={confirmPayment}>
                {text.paymentProcessing}
              </button>
            </div>
          )}
        {order?.status === "READY" && order.fulfillmentSelection && (
          <div className="auth-form">
            <h2>{text.fulfillmentHeading}</h2>
            <p>
              {order.fulfillmentSelection.mode === "PICKUP"
                ? text.pickup
                : text.delivery}
            </p>
            <button
              className="button primary"
              onClick={activateCommittedFulfillment}
            >
              {text.startFulfillment}
            </button>
          </div>
        )}
        {order?.status === "READY" && !order.fulfillmentSelection && (
          <div className="auth-form">
            <h2>{text.fulfillmentHeading}</h2>
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
                    locale === "uz"
                      ? "uz-UZ"
                      : locale === "en"
                        ? "en-GB"
                        : "ru-RU",
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
                <option value="PRINT_QUALITY">{text.printQuality}</option>
                <option value="WRONG_OUTPUT">{text.wrongOutput}</option>
                <option value="DAMAGED">{text.damaged}</option>
                <option value="MISSING_ITEMS">{text.missingItems}</option>
                <option value="DELIVERY_FAILURE">{text.deliveryFailure}</option>
              </select>
              {(order?.items.length ?? 0) > 1 && (
                <fieldset>
                  <legend>{text.issueScope}</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={disputeItems.length === 0}
                      onChange={() => setDisputeItems([])}
                    />{" "}
                    {text.allItems}
                  </label>
                  {order?.items.map((item) => (
                    <label key={item.sequence}>
                      <input
                        type="checkbox"
                        checked={disputeItems.includes(item.sequence)}
                        onChange={(event) =>
                          setDisputeItems((current) =>
                            event.target.checked
                              ? [...current, item.sequence].sort(
                                  (a, b) => a - b,
                                )
                              : current.filter(
                                  (sequence) => sequence !== item.sequence,
                                ),
                          )
                        }
                      />{" "}
                      {text.item} {item.sequence}
                    </label>
                  ))}
                </fieldset>
              )}
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
