"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type LedgerEntry = {
  id: string;
  type: string;
  direction: "CREDIT" | "DEBIT";
  amountMinor: string;
  currency: string;
};

export default function PartnerFinancePage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    void apiRequest("/partner/finance/ledger")
      .then((response) => response.json() as Promise<LedgerEntry[]>)
      .then(setEntries)
      .catch(() => setError(true));
  }, []);
  return (
    <main className="narrow">
      <p className="eyebrow">Партнёр</p>
      <h1>Реестр начислений</h1>
      {error && <p className="error">Не удалось загрузить реестр.</p>}
      <div className="panel">
        {entries.map((entry) => (
          <p key={entry.id}>
            {entry.direction === "CREDIT" ? "+" : "−"}
            {entry.amountMinor} {entry.currency} — {entry.type}
          </p>
        ))}
        {!error && entries.length === 0 && <p>Начислений пока нет.</p>}
      </div>
    </main>
  );
}
