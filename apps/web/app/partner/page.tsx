"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

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
};
type Dispute = {
  id: string;
  category: string;
  status: string;
  responses: { responseCode: string }[];
};

export default function PartnerPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [active, setActive] = useState<ActiveOrder>(null);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [pin, setPin] = useState("");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
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
    } catch {
      setMessage("Войдите как одобренный партнёр.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const decide = async (offer: Offer, decision: "ACCEPT" | "REJECT") => {
    await apiRequest(`/partner/offers/${offer.id}/decision`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ decision }),
    });
    await load();
  };
  const respondDispute = async (
    id: string,
    responseCode: "ACKNOWLEDGED" | "DISAGREES" | "REPRINT_ACCEPTED",
  ) => {
    await apiRequest(`/partner/disputes/${id}/response`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ responseCode }),
    });
    await load();
  };
  const updateStatus = async (status: "IN_PRODUCTION" | "READY") => {
    if (!active) return;
    await apiRequest(`/partner/orders/${active.orderId}/status`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ status }),
    });
    await load();
  };
  const download = async () => {
    if (!active) return;
    const response = await apiRequest(
      `/partner/orders/${active.orderId}/print-ready`,
      { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
    );
    const body = (await response.json()) as { url: string };
    window.location.assign(body.url);
  };
  const confirmHandoff = async () => {
    if (!active) return;
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
      setMessage("Передача подтверждена.");
      await load();
    } catch {
      setMessage("PIN неверен, истёк или переход уже недоступен.");
    }
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Ручное производство</p>
      <h1>Кабинет партнёра</h1>
      <p>
        <a className="button" href="/partner/finance">
          Реестр начислений
        </a>
      </p>
      <section className="panel review-list">
        <h2>Предложения</h2>
        {offers
          .filter((offer) => offer.status === "PENDING")
          .map((offer) => {
            const seconds = Math.max(
              0,
              Math.ceil((Date.parse(offer.expiresAt) - now) / 1000),
            );
            return (
              <article key={offer.id}>
                <strong>{offer.branchName}</strong>
                <p>
                  Выплата: {offer.payout?.amountMinor} {offer.payout?.currency}
                </p>
                <p>Осталось: {seconds} сек.</p>
                <button
                  className="button primary"
                  onClick={() => decide(offer, "ACCEPT")}
                >
                  Принять
                </button>{" "}
                <button
                  className="button secondary"
                  onClick={() => decide(offer, "REJECT")}
                >
                  Отказаться
                </button>
              </article>
            );
          })}
        <h2>Активный заказ</h2>
        {active ? (
          <article>
            <p>Филиал: {active.branchName}</p>
            <p>Статус: {active.status}</p>
            {["PARTNER_ACCEPTED", "REPRINT", "IN_PRODUCTION", "READY"].includes(
              active.status,
            ) && (
              <button className="button secondary" onClick={download}>
                Скачать для печати
              </button>
            )}{" "}
            {["PARTNER_ACCEPTED", "REPRINT"].includes(active.status) && (
              <button
                className="button primary"
                onClick={() => updateStatus("IN_PRODUCTION")}
              >
                Начать печать
              </button>
            )}
            {active.status === "IN_PRODUCTION" && (
              <button
                className="button primary"
                onClick={() => updateStatus("READY")}
              >
                Готово
              </button>
            )}
            {["AWAITING_PICKUP", "COURIER_ASSIGNED"].includes(
              active.status,
            ) && (
              <div className="auth-form">
                <label>
                  PIN передачи
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
                  disabled={!/^\d{6}$/.test(pin)}
                  onClick={confirmHandoff}
                >
                  {active.fulfillmentMode === "PICKUP"
                    ? "Выдать клиенту"
                    : "Передать курьеру"}
                </button>
              </div>
            )}
          </article>
        ) : (
          <p>Активного заказа нет.</p>
        )}
        <h2>Споры по назначенным заказам</h2>
        {disputes.map((item) => (
          <article key={item.id}>
            <strong>{item.category}</strong>
            <p>{item.status}</p>
            {item.responses.length === 0 && (
              <>
                <button
                  className="button primary"
                  onClick={() => respondDispute(item.id, "ACKNOWLEDGED")}
                >
                  Признать
                </button>{" "}
                <button
                  className="button secondary"
                  onClick={() => respondDispute(item.id, "DISAGREES")}
                >
                  Возразить
                </button>
              </>
            )}
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
