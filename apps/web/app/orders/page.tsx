"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";

type Order = {
  id: string;
  presentation: string;
  totalMinor: string | null;
  currency: string | null;
  createdAt: string;
};
const labels = {
  ru: {
    payment: "Ожидает оплаты",
    ready: "Готов к получению",
    delivery: "В доставке",
    completed: "Завершён",
    refunded: "Возврат",
    attention: "Требует внимания",
    in_progress: "В работе",
  },
  uz: {
    payment: "To‘lov kutilmoqda",
    ready: "Olishga tayyor",
    delivery: "Yetkazilmoqda",
    completed: "Bajarildi",
    refunded: "Qaytarildi",
    attention: "E’tibor talab qiladi",
    in_progress: "Jarayonda",
  },
} as const;

export default function OrdersPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    void apiRequest("/orders")
      .then(async (response) =>
        setOrders(((await response.json()) as { orders: Order[] }).orders),
      )
      .catch(() =>
        window.location.assign(
          `/login?next=${encodeURIComponent(`/orders?lang=${locale}`)}&lang=${locale}`,
        ),
      );
  }, [locale]);
  return (
    <main className="narrow">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.orders}</h1>
      <div className="actions">
        <Link className="button primary" href={`/catalog?lang=${locale}`}>
          {text.start}
        </Link>
        <Link
          className="button secondary"
          href={`/notifications?lang=${locale}`}
        >
          {text.notifications}
        </Link>
      </div>
      <section className="review-list">
        {orders.length === 0 && <p>{text.emptyOrders}</p>}
        {orders.map((order) => (
          <Link
            className="order-card"
            key={order.id}
            href={`/orders/${order.id}?lang=${locale}`}
          >
            <strong>
              {labels[locale][order.presentation as keyof typeof labels.ru] ??
                labels[locale].in_progress}
            </strong>
            <span>
              {order.totalMinor} {order.currency}
            </span>
            <small>
              {new Date(order.createdAt).toLocaleDateString(
                locale === "uz" ? "uz-UZ" : "ru-RU",
              )}
            </small>
          </Link>
        ))}
      </section>
    </main>
  );
}
