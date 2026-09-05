"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Overview = {
  fiscalOperations: Array<{
    id: string;
    type: string;
    amountMinor: string;
    currency: string;
    status: string;
  }>;
  batches: Array<{
    id: string;
    sequence: number;
    totalMinor: string;
    currency: string;
    status: string;
  }>;
  incidents: Array<{
    id: string;
    kind: string;
    expectedStatus: string;
    observedStatus: string;
    detailCode?: string;
  }>;
};

export default function FinancePage() {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState(false);
  useEffect(() => {
    void apiRequest("/admin/finance")
      .then((response) => response.json() as Promise<Overview>)
      .then(setData)
      .catch(() => setError(true));
  }, []);
  return (
    <main className="narrow">
      <p className="eyebrow">FINANCE_ADMIN</p>
      <h1>Финансовые операции</h1>
      {error && (
        <p className="error">Доступ запрещён или данные временно недоступны.</p>
      )}
      <section className="panel">
        <h2>Фискализация</h2>
        {data?.fiscalOperations.map((item) => (
          <p key={item.id}>
            {item.type}: {item.amountMinor} {item.currency} — {item.status}
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>Расчётные пакеты</h2>
        {data?.batches.map((item) => (
          <p key={item.id}>
            #{item.sequence}: {item.totalMinor} {item.currency} — {item.status}
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>Несоответствия сверки</h2>
        {data?.incidents.map((item) => (
          <p key={item.id}>
            {item.kind}: {item.expectedStatus} / {item.observedStatus}
          </p>
        ))}
      </section>
    </main>
  );
}
