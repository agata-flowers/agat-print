"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Row = {
  orderId: string;
  orderStatus: string;
  mode: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  printJobStatus: string | null;
};
type Courier = {
  id: string;
  displayName: string;
  serviceZone: string;
  status: string;
  active: boolean;
};

export default function AdminFulfillmentPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [courierId, setCourierId] = useState("");
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [branchId, setBranchId] = useState("");
  const [agentCredential, setAgentCredential] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const [response, couriersResponse] = await Promise.all([
        apiRequest("/admin/fulfillment"),
        apiRequest("/admin/couriers"),
      ]);
      setRows((await response.json()) as Row[]);
      setCouriers((await couriersResponse.json()) as Courier[]);
    } catch {
      setMessage("Требуется роль администратора.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const approveCourier = async () => {
    await apiRequest(`/admin/couriers/${courierId}/approve`, {
      method: "POST",
    });
    setMessage("Курьер одобрен. Роль действует после обновления его сессии.");
    await load();
  };
  const suspendCourier = async (id: string) => {
    await apiRequest(`/admin/couriers/${id}/suspend`, { method: "POST" });
    await load();
  };
  const registerAgent = async () => {
    const response = await apiRequest(
      `/admin/branches/${branchId}/printer-agents`,
      {
        method: "POST",
        body: JSON.stringify({ label: "Основной агент" }),
      },
    );
    const value = (await response.json()) as { agentId: string; token: string };
    setAgentCredential(`${value.agentId} · ${value.token}`);
    setMessage("Скопируйте реквизиты сейчас: токен повторно не отображается.");
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Операции этапа 7</p>
      <h1>Получение и доставка</h1>
      <section className="panel review-list">
        <label>
          ID заявки курьера
          <input
            value={courierId}
            onChange={(event) => setCourierId(event.target.value)}
          />
        </label>
        <button className="button primary" onClick={approveCourier}>
          Одобрить курьера
        </button>
        {couriers.map((courier) => (
          <article key={courier.id}>
            <strong>{courier.displayName}</strong>
            <p>
              {courier.serviceZone} · {courier.status}
            </p>
            {courier.status === "APPROVED" && (
              <button
                className="button secondary"
                onClick={() => suspendCourier(courier.id)}
              >
                Приостановить
              </button>
            )}
          </article>
        ))}
        <label>
          ID филиала
          <input
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          />
        </label>
        <button className="button primary" onClick={registerAgent}>
          Выпустить printer-agent
        </button>
        {agentCredential && (
          <code className="credential-once">{agentCredential}</code>
        )}
        <h2>Текущие операции</h2>
        {rows.map((row) => (
          <article key={row.orderId}>
            <strong>{row.orderStatus}</strong>
            <p>
              {row.mode ?? "—"} · delivery {row.deliveryStatus ?? "—"} · print{" "}
              {row.printJobStatus ?? "—"}
            </p>
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
