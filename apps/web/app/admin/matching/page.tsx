"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type History = {
  orderId: string;
  orderStatus: string;
  matchingStatus: string;
  offers: { id: string; status: string; candidateRank: number }[];
  assignmentStatus: string | null;
};

export default function MatchingAdminPage() {
  const [items, setItems] = useState<History[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void apiRequest("/admin/matching")
      .then(async (response) => setItems((await response.json()) as History[]))
      .catch(() => setMessage("Очередь доступна только администратору."));
  }, []);
  return (
    <main className="narrow">
      <p className="eyebrow">Безопасный аудит</p>
      <h1>История подбора</h1>
      <section className="panel review-list">
        {items.map((item) => (
          <article key={item.orderId}>
            <strong>
              {item.orderStatus} · {item.matchingStatus}
            </strong>
            <p>
              Предложений: {item.offers.length}; назначение:{" "}
              {item.assignmentStatus ?? "нет"}
            </p>
            <ol>
              {item.offers.map((offer) => (
                <li key={offer.id}>
                  #{offer.candidateRank}: {offer.status}
                </li>
              ))}
            </ol>
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
