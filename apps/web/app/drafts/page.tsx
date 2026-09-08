"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";

type Draft = {
  id: string;
  service: { title: string };
  step: string;
  expiresAt: string;
  orderPath: string | null;
};

export default function DraftsPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => {
    void apiRequest("/order-drafts")
      .then(async (response) =>
        setDrafts(
          ((await response.json()) as { drafts: Draft[] }).drafts.filter(
            (draft) => !draft.orderPath && draft.step !== "closed",
          ),
        ),
      )
      .catch(() =>
        window.location.assign(
          `/login?next=${encodeURIComponent(`/drafts?lang=${locale}`)}&lang=${locale}`,
        ),
      );
  }, [locale]);
  return (
    <main className="narrow">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>
        {locale === "uz" ? "Tugallanmagan buyurtmalar" : "Незавершённые заказы"}
      </h1>
      <div className="actions">
        <Link className="button primary" href={`/catalog?lang=${locale}`}>
          {text.start}
        </Link>
        <Link className="button secondary" href={`/orders?lang=${locale}`}>
          {text.orders}
        </Link>
      </div>
      <section className="review-list">
        {drafts.length === 0 && (
          <p>
            {locale === "uz"
              ? "Davom ettiriladigan buyurtma yo‘q."
              : "Нет заказов, которые нужно продолжить."}
          </p>
        )}
        {drafts.map((draft) => (
          <Link
            className="order-card"
            href={`/drafts/${draft.id}?lang=${locale}`}
            key={draft.id}
          >
            <strong>{draft.service.title}</strong>
            <span>
              {locale === "uz" ? "Davom etish" : "Продолжить оформление"}
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
