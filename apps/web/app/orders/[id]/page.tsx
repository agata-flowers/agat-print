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
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderView>();
  const [message, setMessage] = useState("");
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
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
