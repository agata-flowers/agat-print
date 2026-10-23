"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LanguageSwitcher } from "../../components/language-switcher";
import { ApiError, apiRequest } from "../../lib/api";
import {
  customerError,
  useCustomerLocale,
  type CustomerLocale,
} from "../../lib/customer-i18n";

type Offer = {
  id: string;
  orderId: string;
  branchName: string;
  status: string;
  expiresAt: string;
  payout: null | { amountMinor: string; currency: string };
};
type ActiveOrder = null | {
  orderId: string;
  status: string;
  branchName: string;
  fulfillmentMode: "PICKUP" | "DELIVERY" | null;
  deliveryId: string | null;
  items: {
    sequence: number;
    serviceCode: string;
    quantity: number;
    productionStatus: "QUEUED" | "PENDING" | "PRINTING" | "COMPLETED";
  }[];
};
type Dispute = {
  id: string;
  category: string;
  status: string;
  responses: { responseCode: string }[];
};

const copy = {
  ru: {
    eyebrow: "Рабочее место фотостудии",
    title: "Заказы и производство",
    lead: "Принимайте подходящие заказы, скачивайте готовые файлы и отмечайте фактические этапы ручной печати.",
    profile: "Профиль студии",
    finance: "Начисления",
    listing: "Публичная карточка",
    offers: "Новые предложения",
    noOffers: "Новых предложений пока нет.",
    payout: "Выплата студии",
    remaining: "До окончания",
    seconds: "сек.",
    accept: "Принять заказ",
    reject: "Отказаться",
    active: "Активное производство",
    noActive: "Активного заказа нет.",
    branch: "Филиал",
    status: "Статус",
    item: "Позиция",
    quantity: "Количество",
    download: "Скачать для печати",
    startItem: "Начать печать позиции",
    completeItem: "Позиция готова",
    startLegacy: "Начать печать",
    readyLegacy: "Заказ готов",
    pin: "PIN передачи",
    pickupHandoff: "Выдать клиенту",
    deliveryHandoff: "Передать курьеру",
    handoffSuccess: "Передача подтверждена.",
    handoffFailed: "PIN неверен, истёк или передача уже недоступна.",
    disputes: "Обращения по выполненным заказам",
    noDisputes: "Открытых обращений нет.",
    acknowledge: "Признать",
    disagree: "Возразить",
    signIn: "Войдите как сотрудник одобренной студии.",
    actionFailed: "Действие не выполнено. Обновите рабочее место и повторите.",
  },
  uz: {
    eyebrow: "Fotostudiya ish joyi",
    title: "Buyurtmalar va ishlab chiqarish",
    lead: "Mos buyurtmalarni qabul qiling, tayyor fayllarni yuklab oling va qo‘lda chop etish bosqichlarini belgilang.",
    profile: "Studiya profili",
    finance: "Hisob-kitoblar",
    listing: "Ommaviy sahifa",
    offers: "Yangi takliflar",
    noOffers: "Hozircha yangi taklif yo‘q.",
    payout: "Studiya to‘lovi",
    remaining: "Tugashiga",
    seconds: "soniya",
    accept: "Buyurtmani qabul qilish",
    reject: "Rad etish",
    active: "Faol ishlab chiqarish",
    noActive: "Faol buyurtma yo‘q.",
    branch: "Filial",
    status: "Holat",
    item: "Pozitsiya",
    quantity: "Miqdor",
    download: "Chop etish uchun yuklab olish",
    startItem: "Pozitsiyani chop etishni boshlash",
    completeItem: "Pozitsiya tayyor",
    startLegacy: "Chop etishni boshlash",
    readyLegacy: "Buyurtma tayyor",
    pin: "Topshirish PIN-kodi",
    pickupHandoff: "Mijozga berish",
    deliveryHandoff: "Kuryerga topshirish",
    handoffSuccess: "Topshirish tasdiqlandi.",
    handoffFailed: "PIN noto‘g‘ri, muddati o‘tgan yoki topshirish yopilgan.",
    disputes: "Bajarilgan buyurtmalar bo‘yicha murojaatlar",
    noDisputes: "Ochiq murojaatlar yo‘q.",
    acknowledge: "Tan olish",
    disagree: "E’tiroz bildirish",
    signIn: "Tasdiqlangan studiya xodimi sifatida kiring.",
    actionFailed:
      "Amal bajarilmadi. Ish joyini yangilang va qayta urinib ko‘ring.",
  },
  en: {
    eyebrow: "Photo studio workspace",
    title: "Orders and production",
    lead: "Accept eligible orders, download print-ready files, and record the actual stages of manual production.",
    profile: "Studio profile",
    finance: "Earnings",
    listing: "Public listing",
    offers: "New offers",
    noOffers: "There are no new offers.",
    payout: "Studio payout",
    remaining: "Time remaining",
    seconds: "sec.",
    accept: "Accept order",
    reject: "Decline",
    active: "Active production",
    noActive: "There is no active order.",
    branch: "Branch",
    status: "Status",
    item: "Item",
    quantity: "Quantity",
    download: "Download for printing",
    startItem: "Start printing item",
    completeItem: "Item is ready",
    startLegacy: "Start printing",
    readyLegacy: "Order is ready",
    pin: "Handover PIN",
    pickupHandoff: "Hand to customer",
    deliveryHandoff: "Hand to courier",
    handoffSuccess: "Handover confirmed.",
    handoffFailed: "The PIN is invalid, expired, or handover is unavailable.",
    disputes: "Requests about fulfilled orders",
    noDisputes: "There are no open requests.",
    acknowledge: "Acknowledge",
    disagree: "Disagree",
    signIn: "Sign in as an employee of an approved studio.",
    actionFailed:
      "The action could not be completed. Refresh the workspace and try again.",
  },
} as const;

const statusLabels: Record<CustomerLocale, Record<string, string>> = {
  ru: {
    PARTNER_ACCEPTED: "Заказ принят",
    REPRINT: "Повторная печать",
    IN_PRODUCTION: "В производстве",
    READY: "Готов",
    AWAITING_PICKUP: "Ожидает выдачи",
    COURIER_ASSIGNED: "Ожидает передачи курьеру",
  },
  uz: {
    PARTNER_ACCEPTED: "Buyurtma qabul qilindi",
    REPRINT: "Qayta chop etish",
    IN_PRODUCTION: "Ishlab chiqarishda",
    READY: "Tayyor",
    AWAITING_PICKUP: "Berishni kutmoqda",
    COURIER_ASSIGNED: "Kuryerga topshirish kutilmoqda",
  },
  en: {
    PARTNER_ACCEPTED: "Order accepted",
    REPRINT: "Reprint",
    IN_PRODUCTION: "In production",
    READY: "Ready",
    AWAITING_PICKUP: "Awaiting collection",
    COURIER_ASSIGNED: "Awaiting courier handover",
  },
};

const serviceLabels: Record<CustomerLocale, Record<string, string>> = {
  ru: {
    DOCUMENT_PRINT: "Печать документов",
    PHOTO_PRINT: "Печать фотографий",
    ID_PHOTO: "Фото на документы",
    PRINT: "Печать",
  },
  uz: {
    DOCUMENT_PRINT: "Hujjatlarni chop etish",
    PHOTO_PRINT: "Fotosuratlarni chop etish",
    ID_PHOTO: "Hujjat uchun foto",
    PRINT: "Chop etish",
  },
  en: {
    DOCUMENT_PRINT: "Document printing",
    PHOTO_PRINT: "Photo printing",
    ID_PHOTO: "ID photo",
    PRINT: "Printing",
  },
};

const disputeLabels: Record<CustomerLocale, Record<string, string>> = {
  ru: {
    PRINT_QUALITY: "Качество печати",
    WRONG_OUTPUT: "Неверный результат",
    DAMAGED: "Повреждение",
    MISSING_ITEMS: "Не хватает позиций",
    DELIVERY_FAILURE: "Проблема доставки",
  },
  uz: {
    PRINT_QUALITY: "Chop etish sifati",
    WRONG_OUTPUT: "Noto‘g‘ri natija",
    DAMAGED: "Shikastlangan",
    MISSING_ITEMS: "Pozitsiyalar yetishmaydi",
    DELIVERY_FAILURE: "Yetkazish muammosi",
  },
  en: {
    PRINT_QUALITY: "Print quality",
    WRONG_OUTPUT: "Incorrect output",
    DAMAGED: "Damaged",
    MISSING_ITEMS: "Missing items",
    DELIVERY_FAILURE: "Delivery problem",
  },
};

export default function PartnerPage() {
  const locale = useCustomerLocale();
  const text = copy[locale];
  const [offers, setOffers] = useState<Offer[]>([]);
  const [active, setActive] = useState<ActiveOrder>(null);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [pin, setPin] = useState("");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [offersResponse, activeResponse, disputeResponse] =
        await Promise.all([
          apiRequest("/partner/offers"),
          apiRequest("/partner/orders/active"),
          apiRequest("/partner/disputes"),
        ]);
      setOffers((await offersResponse.json()) as Offer[]);
      setActive((await activeResponse.json()) as ActiveOrder);
      setDisputes((await disputeResponse.json()) as Dispute[]);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 401
          ? text.signIn
          : customerError(
              error instanceof ApiError ? error.code : "REQUEST_FAILED",
              locale,
            ),
      );
    }
  }, [locale, text.signIn]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
    } catch {
      setMessage(text.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const decide = (offer: Offer, decision: "ACCEPT" | "REJECT") =>
    perform(async () => {
      await apiRequest(`/partner/offers/${offer.id}/decision`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ decision }),
      });
    });

  const respondDispute = (
    id: string,
    responseCode: "ACKNOWLEDGED" | "DISAGREES" | "REPRINT_ACCEPTED",
  ) =>
    perform(async () => {
      await apiRequest(`/partner/disputes/${id}/response`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ responseCode }),
      });
    });

  const updateStatus = (status: "IN_PRODUCTION" | "READY") =>
    perform(async () => {
      if (!active) return;
      await apiRequest(`/partner/orders/${active.orderId}/status`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ status }),
      });
    });

  const updateItemStatus = (
    sequence: number,
    status: "PRINTING" | "COMPLETED",
  ) =>
    perform(async () => {
      if (!active) return;
      await apiRequest(
        `/partner/orders/${active.orderId}/items/${sequence}/status`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ status }),
        },
      );
    });

  const download = (sequence?: number) =>
    perform(async () => {
      if (!active) return;
      const response = await apiRequest(
        sequence === undefined
          ? `/partner/orders/${active.orderId}/print-ready`
          : `/partner/orders/${active.orderId}/items/${sequence}/print-ready`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      const body = (await response.json()) as { url: string };
      window.location.assign(body.url);
    });

  const confirmHandoff = async () => {
    if (!active) return;
    setBusy(true);
    const path =
      active.fulfillmentMode === "PICKUP"
        ? `/partner/orders/${active.orderId}/pickup/complete`
        : `/partner/deliveries/${active.deliveryId}/handoff`;
    try {
      await apiRequest(path, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ pin }),
      });
      setPin("");
      await load();
      setMessage(text.handoffSuccess);
    } catch {
      setMessage(text.handoffFailed);
    } finally {
      setBusy(false);
    }
  };

  const pending = offers.filter((offer) => offer.status === "PENDING");

  return (
    <main className="studio-workspace">
      <header className="studio-heading">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p className="lead small">{text.lead}</p>
        </div>
        <LanguageSwitcher />
      </header>
      <nav className="studio-tools" aria-label={text.title}>
        <Link
          className="button secondary"
          href={`/partner/network?lang=${locale}`}
        >
          {text.profile}
        </Link>
        <Link
          className="button secondary"
          href={`/partner/finance?lang=${locale}`}
        >
          {text.finance}
        </Link>
        <Link
          className="button secondary"
          href={`/partner/listing?lang=${locale}`}
        >
          {text.listing}
        </Link>
      </nav>

      <div className="studio-grid">
        <section className="workspace-card offers-card">
          <div className="workspace-card-heading">
            <h2>{text.offers}</h2>
            <span className="count-badge">{pending.length}</span>
          </div>
          {pending.length === 0 && (
            <p className="empty-state">{text.noOffers}</p>
          )}
          {pending.map((offer) => {
            const seconds = Math.max(
              0,
              Math.ceil((Date.parse(offer.expiresAt) - now) / 1000),
            );
            return (
              <article className="offer-card" key={offer.id}>
                <strong>{offer.branchName}</strong>
                <dl>
                  <div>
                    <dt>{text.payout}</dt>
                    <dd>
                      {offer.payout?.amountMinor} {offer.payout?.currency}
                    </dd>
                  </div>
                  <div>
                    <dt>{text.remaining}</dt>
                    <dd>
                      {seconds} {text.seconds}
                    </dd>
                  </div>
                </dl>
                <div className="actions compact-actions">
                  <button
                    className="button primary"
                    disabled={busy || seconds === 0}
                    onClick={() => decide(offer, "ACCEPT")}
                  >
                    {text.accept}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => decide(offer, "REJECT")}
                  >
                    {text.reject}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <section className="workspace-card production-card">
          <div className="workspace-card-heading">
            <h2>{text.active}</h2>
            {active && (
              <span className="status-pill">
                {statusLabels[locale][active.status] ?? text.active}
              </span>
            )}
          </div>
          {!active ? (
            <p className="empty-state">{text.noActive}</p>
          ) : (
            <article className="active-production">
              <p>
                <strong>{text.branch}:</strong> {active.branchName}
              </p>
              <p>
                <strong>{text.status}:</strong>{" "}
                {statusLabels[locale][active.status] ?? text.active}
              </p>
              {[
                "PARTNER_ACCEPTED",
                "REPRINT",
                "IN_PRODUCTION",
                "READY",
              ].includes(active.status) && (
                <div className="production-items">
                  {(active.items.length > 0
                    ? active.items
                    : [
                        {
                          sequence: 1,
                          serviceCode: "PRINT",
                          quantity: 1,
                          productionStatus: "PENDING" as const,
                        },
                      ]
                  ).map((item) => (
                    <article className="production-item" key={item.sequence}>
                      <div>
                        <span className="step-kicker">
                          {text.item} {item.sequence}
                        </span>
                        <h3>
                          {serviceLabels[locale][item.serviceCode] ??
                            serviceLabels[locale].PRINT}
                        </h3>
                        <p>
                          {text.quantity}: {item.quantity}
                        </p>
                      </div>
                      <div className="actions compact-actions">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            download(
                              active.items.length > 0
                                ? item.sequence
                                : undefined,
                            )
                          }
                        >
                          {text.download}
                        </button>
                        {active.items.length > 0 &&
                          item.productionStatus === "PENDING" && (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() =>
                                updateItemStatus(item.sequence, "PRINTING")
                              }
                            >
                              {text.startItem}
                            </button>
                          )}
                        {active.items.length > 0 &&
                          item.productionStatus !== "COMPLETED" && (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() =>
                                updateItemStatus(item.sequence, "COMPLETED")
                              }
                            >
                              {text.completeItem}
                            </button>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {active.items.length === 0 &&
                ["PARTNER_ACCEPTED", "REPRINT"].includes(active.status) && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => updateStatus("IN_PRODUCTION")}
                  >
                    {text.startLegacy}
                  </button>
                )}
              {active.items.length === 0 &&
                active.status === "IN_PRODUCTION" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => updateStatus("READY")}
                  >
                    {text.readyLegacy}
                  </button>
                )}
              {["AWAITING_PICKUP", "COURIER_ASSIGNED"].includes(
                active.status,
              ) && (
                <div className="auth-form handoff-card">
                  <label>
                    {text.pin}
                    <input
                      value={pin}
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      onChange={(event) => setPin(event.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || !/^\d{6}$/.test(pin)}
                    onClick={confirmHandoff}
                  >
                    {active.fulfillmentMode === "PICKUP"
                      ? text.pickupHandoff
                      : text.deliveryHandoff}
                  </button>
                </div>
              )}
            </article>
          )}
        </section>
      </div>

      <section className="workspace-card disputes-card">
        <div className="workspace-card-heading">
          <h2>{text.disputes}</h2>
        </div>
        {disputes.length === 0 && (
          <p className="empty-state">{text.noDisputes}</p>
        )}
        {disputes.map((item) => (
          <article className="dispute-card" key={item.id}>
            <strong>
              {disputeLabels[locale][item.category] ?? text.disputes}
            </strong>
            {item.responses.length === 0 && (
              <div className="actions compact-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => respondDispute(item.id, "ACKNOWLEDGED")}
                >
                  {text.acknowledge}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => respondDispute(item.id, "DISAGREES")}
                >
                  {text.disagree}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
      <p className="workspace-message" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
