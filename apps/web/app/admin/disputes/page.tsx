"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Dispute = { id: string; category: string; status: string };
type Detail = Dispute & {
  orderId: string;
  structuredComment: string | null;
  refundableMinor: string;
  responses: { responseCode: string }[];
  cycles: { sequence: number; kind: string; status: string }[];
  resolution: { type: string; refundAmountMinor: string | null } | null;
};
type Retention = {
  active: number;
  held: number;
  pendingDeletion: number;
  holds: { id: string; orderId: string; reasonCode: string }[];
};
export default function AdminDisputesPage() {
  const [items, setItems] = useState<Dispute[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [retention, setRetention] = useState<Retention>();
  const [amount, setAmount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("LEGAL_REQUEST");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Retry keys stay only in memory and are reused after an uncertain response.
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    try {
      const [disputes, holds] = await Promise.all([
        apiRequest("/admin/disputes"),
        apiRequest("/admin/retention"),
      ]);
      setItems((await disputes.json()) as Dispute[]);
      setRetention((await holds.json()) as Retention);
    } catch {
      setMessage("Требуется роль администратора.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const inspect = async (id: string) => {
    try {
      const response = await apiRequest("/admin/disputes/" + id);
      const selected = (await response.json()) as Detail;
      setDetail(selected);
      setOrderId(selected.orderId);
      setAmount("");
    } catch {
      setMessage("Спор недоступен.");
    }
  };
  const mutate = async (
    path: string,
    method: "POST" | "DELETE",
    body: object = {},
  ) => {
    const payload = JSON.stringify(body);
    const operation = method + path + payload;
    const key = keys.current.get(operation) ?? crypto.randomUUID();
    keys.current.set(operation, key);
    setBusy(true);
    try {
      await apiRequest(path, {
        method,
        headers: { "Idempotency-Key": key },
        ...(method === "POST" ? { body: payload } : {}),
      });
      keys.current.delete(operation);
      setMessage("Изменение сохранено.");
      await load();
      if (detail) await inspect(detail.id);
    } catch {
      setMessage(
        "Операция не подтверждена. Повторите тот же запрос или обновите состояние.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="narrow">
      <h1>Споры и хранение документов</h1>
      <section className="panel review-list">
        {items.map((item) => (
          <article key={item.id}>
            <strong>{item.category}</strong>
            <p>{item.status}</p>
            <button
              className="button secondary"
              onClick={() => inspect(item.id)}
            >
              Открыть
            </button>
          </article>
        ))}
        {detail && (
          <article>
            <h2>Решение по спору</h2>
            <p>
              {detail.category} · {detail.status}
            </p>
            {detail.structuredComment && <p>{detail.structuredComment}</p>}
            <p>
              Ответ партнёра:{" "}
              {detail.responses.map((r) => r.responseCode).join(", ") ||
                "Ожидается"}
            </p>
            <p>
              Доступно к возврату: {detail.refundableMinor} минимальных единиц
              UZS
            </p>
            {detail.cycles.map((c) => (
              <p key={c.sequence}>
                Цикл {c.sequence}: {c.kind} · {c.status}
              </p>
            ))}
            {detail.resolution ? (
              <p>
                Неизменяемое решение: {detail.resolution.type}{" "}
                {detail.resolution.refundAmountMinor}
              </p>
            ) : (
              ["OPEN", "PARTNER_RESPONDED"].includes(detail.status) && (
                <>
                  <label>
                    Частичный возврат, минимальные единицы UZS
                    <input
                      inputMode="numeric"
                      pattern="[0-9]+"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  {(
                    [
                      ["NO_ACTION", "Без компенсации"],
                      ["REPRINT", "Повторная печать"],
                      ["PARTIAL_REFUND", "Частичный возврат"],
                      ["FULL_REFUND", "Полный возврат"],
                    ] as const
                  ).map(([resolution, title]) => (
                    <button
                      key={resolution}
                      disabled={busy}
                      className="button secondary"
                      onClick={() =>
                        mutate(
                          "/admin/disputes/" + detail.id + "/decision",
                          "POST",
                          {
                            resolution,
                            ...(resolution === "PARTIAL_REFUND"
                              ? { refundAmountMinor: amount }
                              : {}),
                          },
                        )
                      }
                    >
                      {title}
                    </button>
                  ))}
                  <p>
                    Возврат окончателен только после подтверждения провайдера.
                    Повторная печать не совмещается с возвратом.
                  </p>
                </>
              )
            )}
          </article>
        )}
      </section>
      <section className="panel">
        <h2>Legal hold</h2>
        <p>
          Расписаний: {retention?.active ?? 0}; удержаний:{" "}
          {retention?.held ?? 0}; ожидают удаления:{" "}
          {retention?.pendingDeletion ?? 0}.
        </p>
        <label>
          Заказ
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Основание
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="LEGAL_REQUEST">Юридический запрос</option>
            <option value="SECURITY_INCIDENT">Инцидент безопасности</option>
            <option value="REGULATORY_REVIEW">Регуляторная проверка</option>
          </select>
        </label>
        <button
          disabled={busy || !orderId}
          className="button secondary"
          onClick={() =>
            mutate("/admin/orders/" + orderId + "/retention-holds", "POST", {
              reasonCode: reason,
            })
          }
        >
          Приостановить удаление
        </button>
        {retention?.holds.map((hold) => (
          <article key={hold.id}>
            <p>{hold.reasonCode}</p>
            {hold.reasonCode === "OPEN_DISPUTE" ? (
              <p>Снимается только после решения или отмены спора.</p>
            ) : (
              <button
                disabled={busy}
                className="button secondary"
                onClick={() =>
                  mutate(
                    "/admin/orders/" +
                      hold.orderId +
                      "/retention-holds/" +
                      hold.id,
                    "DELETE",
                  )
                }
              >
                Снять удержание
              </button>
            )}
          </article>
        ))}
      </section>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
