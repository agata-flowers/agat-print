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
  fiscal: Array<{
    type: string;
    status: string;
    amountMinor: string;
    currency: string;
  }>;
  fulfillment: null | {
    mode: "PICKUP" | "DELIVERY";
    status: string;
    expiresAt: string;
    deliveryStatus: string | null;
  };
};
type DisputeView = {
  id: string;
  category: string;
  status: string;
  resolution: null | {
    type: string;
    refundAmountMinor: string | null;
    currency: string | null;
  };
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderView>();
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState("");
  const [completionPin, setCompletionPin] = useState("");
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [category, setCategory] = useState("PRINT_QUALITY");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest(`/orders/${id}`);
      setOrder((await response.json()) as OrderView);
      const disputeResponse = await apiRequest(`/orders/${id}/disputes`);
      setDisputes(
        ((await disputeResponse.json()) as { disputes: DisputeView[] })
          .disputes,
      );
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
        mockCallback?: unknown;
        mockSignature?: string;
      };
      if (started.mockCallback && started.mockSignature) {
        await apiRequest("/payments/mock/callback", {
          method: "POST",
          headers: { "X-Provider-Signature": started.mockSignature },
          body: JSON.stringify(started.mockCallback),
        });
        setMessage("Оплата подтверждена тестовым провайдером.");
      } else {
        await apiRequest(`/orders/${id}/payment/confirm`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: "{}",
        });
        setMessage(
          "Подтверждение отправлено. Ожидаем ответ платёжного провайдера.",
        );
      }
      await load();
    } catch {
      setMessage("Оплата не завершена. Повторите безопасно с новой попыткой.");
    }
  };
  const openDispute = async () => {
    try {
      await apiRequest(`/orders/${id}/disputes`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ category }),
      });
      setMessage("Спор открыт. Материалы заказа защищены legal hold.");
      await load();
    } catch {
      setMessage("Спор недоступен или 72-часовое окно истекло.");
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
      setMessage("Спор уже рассматривается или недоступен.");
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
        {order?.fiscal?.map((operation, index) => (
          <p key={`${operation.type}-${index}`}>
            Фискальная операция {operation.type}: {operation.status} ·{" "}
            {operation.amountMinor} {operation.currency}
          </p>
        ))}
        {order?.status === "AWAITING_PAYMENT" && (
          <button className="button primary" type="button" onClick={pay}>
            Оплатить
          </button>
        )}
        {order?.status === "REFUND_PENDING" && (
          <p>Возврат ожидает подтверждения.</p>
        )}
        {order?.status === "REFUNDED" && <p>Полный возврат подтверждён.</p>}
        {order?.status === "PARTIALLY_REFUNDED" && (
          <p>Частичный возврат подтверждён.</p>
        )}
        {order?.status === "DISPUTED" && (
          <p>Спор рассматривается оператором.</p>
        )}
        {order?.status === "REPRINT" && (
          <p>Назначена повторная печать утверждённого макета.</p>
        )}
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
        {["COMPLETED", "DELIVERY_FAILED"].includes(order?.status ?? "") &&
          !disputes.some((item) =>
            ["OPEN", "PARTNER_RESPONDED"].includes(item.status),
          ) && (
            <div className="auth-form">
              <h2>Сообщить о проблеме</h2>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="PRINT_QUALITY">Качество печати</option>
                <option value="WRONG_OUTPUT">Неверный результат</option>
                <option value="DAMAGED">Повреждение</option>
                <option value="MISSING_ITEMS">Не хватает материалов</option>
                <option value="DELIVERY_FAILURE">Проблема доставки</option>
              </select>
              <button className="button secondary" onClick={openDispute}>
                Открыть спор
              </button>
            </div>
          )}
        {disputes.map((item) => (
          <article key={item.id}>
            <strong>{item.category}</strong>
            <p>
              {item.status}
              {item.resolution ? ` · ${item.resolution.type}` : ""}
            </p>
            {item.status === "OPEN" && (
              <button
                className="button secondary"
                onClick={() => cancelDispute(item.id)}
              >
                Отменить обращение
              </button>
            )}
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
