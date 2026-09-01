"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type Delivery = null | {
  id: string;
  orderStatus: string;
  status: string;
  branchName: string;
  handoffPin?: string;
  deliveryAddress?: string;
};

export default function CourierPage() {
  const [delivery, setDelivery] = useState<Delivery>(null);
  const [displayName, setDisplayName] = useState("");
  const [serviceZone, setServiceZone] = useState("TASHKENT");
  const [completionPin, setCompletionPin] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/courier/deliveries/active");
      setDelivery((await response.json()) as Delivery);
      setMessage("");
    } catch {
      setMessage("Подайте заявку или дождитесь одобрения администратора.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const apply = async () => {
    try {
      await apiRequest("/couriers", {
        method: "POST",
        body: JSON.stringify({ displayName, serviceZone }),
      });
      setMessage("Заявка курьера отправлена на проверку.");
    } catch {
      setMessage("Не удалось отправить заявку.");
    }
  };

  const complete = async () => {
    if (!delivery) return;
    try {
      await apiRequest(`/courier/deliveries/${delivery.id}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ pin: completionPin }),
      });
      setCompletionPin("");
      setMessage("Доставка подтверждена.");
      await load();
    } catch {
      setMessage("PIN неверен или доставка недоступна для завершения.");
    }
  };

  const fail = async () => {
    if (!delivery) return;
    await apiRequest(`/courier/deliveries/${delivery.id}/fail`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ reason: "RECIPIENT_UNAVAILABLE" }),
    });
    await load();
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Доставка</p>
      <h1>Кабинет курьера</h1>
      <section className="panel review-list">
        {delivery ? (
          <article>
            <p>Филиал: {delivery.branchName}</p>
            <p>Статус: {delivery.orderStatus}</p>
            {delivery.handoffPin && (
              <p className="pin">
                PIN получения у партнёра: <strong>{delivery.handoffPin}</strong>
              </p>
            )}
            {delivery.deliveryAddress && (
              <p>Адрес назначения: {delivery.deliveryAddress}</p>
            )}
            {delivery.orderStatus === "IN_DELIVERY" && (
              <div className="auth-form">
                <label>
                  PIN клиента
                  <input
                    value={completionPin}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setCompletionPin(event.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={!/^\d{6}$/.test(completionPin)}
                  onClick={complete}
                >
                  Доставлено
                </button>
              </div>
            )}
            <button className="button secondary" onClick={fail}>
              Доставка не состоялась
            </button>
          </article>
        ) : (
          <div className="auth-form">
            <h2>Заявка курьера</h2>
            <label>
              Отображаемое имя
              <input
                value={displayName}
                maxLength={160}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Зона обслуживания
              <input
                value={serviceZone}
                maxLength={40}
                onChange={(event) => setServiceZone(event.target.value)}
              />
            </label>
            <button className="button primary" onClick={apply}>
              Отправить заявку
            </button>
          </div>
        )}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
