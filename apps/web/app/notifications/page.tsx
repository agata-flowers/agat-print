"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";

type Notice = {
  id: string;
  status: string;
  title: string;
  message: string;
  createdAt: string;
};
export default function NotificationsPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [items, setItems] = useState<Notice[]>([]);
  const load = async () => {
    const response = await apiRequest(`/notifications?locale=${locale}`);
    setItems(
      ((await response.json()) as { notifications: Notice[] }).notifications,
    );
  };
  useEffect(() => {
    void load();
  }, [locale]);
  const read = async (id: string) => {
    await apiRequest(`/notifications/${id}/read`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: "{}",
    });
    await load();
  };
  return (
    <main className="narrow">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.notifications}</h1>
      <section className="review-list">
        {items.length === 0 && <p>{text.emptyNotifications}</p>}
        {items.map((item) => (
          <article
            className={item.status === "unread" ? "notice unread" : "notice"}
            key={item.id}
          >
            <h2>{item.title}</h2>
            <p>{item.message}</p>
            {item.status === "unread" && (
              <button
                className="button secondary"
                onClick={() => read(item.id)}
              >
                {locale === "uz" ? "O‘qildi" : "Прочитано"}
              </button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
