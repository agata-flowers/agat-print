"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../../../lib/api";

type Tariff = {
  version: number;
  status: string;
  basePriceMinor: string;
  perPagePriceMinor: string;
  currency: string;
};

type Audit = {
  eventType: string;
  targetType: string | null;
  createdAt: string;
};

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [message, setMessage] = useState("");
  const load = async () => {
    const [tariffResponse, auditResponse] = await Promise.all([
      apiRequest("/admin/tariffs"),
      apiRequest("/admin/finance/audit"),
    ]);
    setTariffs((await tariffResponse.json()) as Tariff[]);
    setAudit((await auditResponse.json()) as Audit[]);
  };
  useEffect(() => {
    void load().catch(() => setMessage("Требуется роль администратора."));
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await apiRequest("/admin/tariffs", {
      method: "POST",
      body: JSON.stringify({
        basePriceMinor: data.get("base"),
        perPagePriceMinor: data.get("page"),
      }),
    });
    setMessage("Новая версия тарифа активирована.");
    await load();
  };
  return (
    <main className="narrow">
      <p className="eyebrow">Администратор</p>
      <h1>Версии тарифов</h1>
      <form className="panel" onSubmit={submit}>
        <label>
          Базовая цена, UZS
          <input name="base" inputMode="numeric" required />
        </label>
        <label>
          Цена страницы, UZS
          <input name="page" inputMode="numeric" required />
        </label>
        <button className="button primary" type="submit">
          Активировать версию
        </button>
      </form>
      <section className="panel">
        {tariffs.map((tariff) => (
          <p key={tariff.version}>
            v{tariff.version} · {tariff.status} · {tariff.basePriceMinor} +{" "}
            {tariff.perPagePriceMinor}/стр. {tariff.currency}
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>Безопасный финансовый аудит</h2>
        {audit.map((entry, index) => (
          <p key={`${entry.createdAt}-${index}`}>
            {entry.eventType} · {entry.createdAt}
          </p>
        ))}
      </section>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
