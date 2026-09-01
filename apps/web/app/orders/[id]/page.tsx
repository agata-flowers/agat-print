"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type OrderView = {
  id: string;
  status: string;
  price: null | {
    totalMinor: string;
    currency: string;
    quantity: number;
    tariffVersion: number;
  };
  payment: null | { status: string; refundStatus: string | null };
  fulfillment: null | {
    mode: "PICKUP" | "DELIVERY";
    status: string;
    expiresAt: string;
    deliveryStatus: string | null;
  };
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderView>();
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState("");
  const [completionPin, setCompletionPin] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest(`/orders/${id}`);
      setOrder((await response.json()) as OrderView);
    } catch {
      setMessage("Заказ недоступен или не принадлежит вам.");
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  const pay = async () => {
    try {
      const response = await apiRequest(`/orders/${id}/payment`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ simulateOutcome: "SUCCESS" }),
      });
      const started = (await response.json()) as {
        mockCallback: unknown;
        mockSignature: string;
      };
      await apiRequest("/payments/mock/callback", {
        method: "POST",
        headers: { "X-Provider-Signature": started.mockSignature },
        body: JSON.stringify(started.mockCallback),
      });
      setMessage("Оплата подтверждена mock-провайдером.");
      await load();
    } catch {
      setMessage("Оплата не завершена. Повторите безопасно с новой попыткой.");
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
      const body = (await response.json()) as { completionPin: string };
      setCompletionPin(body.completionPin);
      setMessage(
        "Сохраните PIN до получения заказа. Он больше нигде не отображается.",
      );
      await load();
    } catch {
      setMessage("Не удалось выбрать способ получения.");
    }
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Заказ и оплата</p>
      <h1>Итоговая цена</h1>
      <section className="panel">
        {order?.price && (
          <>
            <p>
              {order.price.totalMinor} {order.price.currency} · количество{" "}
              {order.price.quantity}
            </p>
            <p>Версия тарифа: {order.price.tariffVersion}</p>
          </>
        )}
        <p>Статус заказа: {order?.status ?? "LOADING"}</p>
        <p>Статус платежа: {order?.payment?.status ?? "NOT_STARTED"}</p>
        {order?.status === "AWAITING_PAYMENT" && (
          <button className="button primary" type="button" onClick={pay}>
            Оплатить
          </button>
        )}
        {order?.status === "REFUND_PENDING" && (
          <p>Возврат ожидает подтверждения.</p>
        )}
        {order?.status === "REFUNDED" && <p>Полный возврат подтверждён.</p>}
        {order?.status === "READY" && (
          <div className="auth-form">
            <h2>Получение заказа</h2>
            <button
              className="button secondary"
              type="button"
              onClick={() => requestFulfillment("PICKUP")}
            >
              Самовывоз
            </button>
            <label>
              Адрес доставки
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
              type="button"
              disabled={address.length < 8}
              onClick={() => requestFulfillment("DELIVERY")}
            >
              Заказать доставку
            </button>
          </div>
        )}
        {completionPin && (
          <p className="pin" role="status">
            PIN получения: <strong>{completionPin}</strong>
          </p>
        )}
        {order?.status === "AWAITING_PICKUP" && <p>Заказ ожидает выдачи.</p>}
        {order?.status === "COURIER_ASSIGNED" && <p>Курьер назначен.</p>}
        {order?.status === "IN_DELIVERY" && <p>Заказ в доставке.</p>}
        {order?.status === "DELIVERY_FAILED" && <p>Доставка не состоялась.</p>}
        {order?.status === "COMPLETED" && <p>Заказ успешно завершён.</p>}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
