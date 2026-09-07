"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Partner = {
  id: string;
  displayName: string;
  status: string;
  branches: {
    id: string;
    name: string;
    acceptingOrders: boolean;
    active: boolean;
  }[];
};

export default function PartnerAdminPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/admin/partners");
      setPartners((await response.json()) as Partner[]);
    } catch {
      setMessage("Раздел доступен только администратору.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const moderate = async (
    id: string,
    status: "ACTIVE" | "SUSPENDED" | "REJECTED" | "CLOSED",
  ) => {
    await apiRequest(`/admin/partners/${id}/lifecycle`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ status }),
    });
    await load();
  };
  return (
    <main className="narrow">
      <p className="eyebrow">Модерация сети</p>
      <h1>Партнёры и филиалы</h1>
      <section className="panel review-list">
        {partners.map((partner) => (
          <article key={partner.id}>
            <strong>{partner.displayName}</strong>
            <p>
              {partner.status} · филиалов: {partner.branches.length}
            </p>
            <button
              className="button primary"
              onClick={() => moderate(partner.id, "ACTIVE")}
            >
              Активировать
            </button>{" "}
            <button
              className="button secondary"
              onClick={() => moderate(partner.id, "SUSPENDED")}
            >
              Приостановить
            </button>{" "}
            <button
              className="button secondary"
              onClick={() => moderate(partner.id, "REJECTED")}
            >
              Отклонить
            </button>
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
