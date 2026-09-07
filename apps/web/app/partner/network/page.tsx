"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Branch = {
  id: string;
  name: string;
  timezone: string;
  acceptingOrders: boolean;
  active: boolean;
  capability: null | { version: number };
  catalog: null | { version: number };
  capacity: null | { version: number; maxConcurrentOrders: number };
  operational: null | { version: number };
};
type Workspace = {
  displayName: string;
  status: string;
  branches: Branch[];
};

export default function PartnerNetworkPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/partners/workspace");
      setWorkspace((await response.json()) as Workspace);
    } catch {
      setMessage("Сеть доступна только активному партнёру.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const toggle = async (branch: Branch) => {
    await apiRequest(`/partners/me/branches/${branch.id}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ acceptingOrders: !branch.acceptingOrders }),
    });
    setMessage(
      branch.acceptingOrders
        ? "Новые предложения приостановлены."
        : "Приём новых предложений включён.",
    );
    await load();
  };
  const postVersion = (branch: Branch, path: string, body: unknown) =>
    apiRequest(`/partner/network/branches/${branch.id}/${path}`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
  const configure = async (branch: Branch) => {
    if (!branch.capability)
      await postVersion(branch, "capabilities", {
        supportedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
        maxPages: 100,
        maxWidthMm: 500,
        maxHeightMm: 500,
        minDpi: 300,
        priority: 100,
        serviceCodes: ["DOCUMENT_PRINT", "PHOTO_PRINT"],
        paperCodes: ["STANDARD", "PHOTO"],
        colorModes: ["COLOR", "MONOCHROME"],
        equipmentCodes: [],
        maxQuantity: 1000,
      });
    if (!branch.operational)
      await postVersion(branch, "operations", {
        weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          opensMinute: 540,
          closesMinute: 1080,
        })),
        pickupEnabled: true,
        printerAgentEnabled: false,
      });
    if (!branch.catalog)
      await postVersion(branch, "catalogs", {
        items: [
          {
            serviceCode: "DOCUMENT_PRINT",
            enabled: true,
            paperCodes: ["STANDARD"],
            colorModes: ["COLOR", "MONOCHROME"],
            maxQuantity: 1000,
          },
        ],
      });
    if (!branch.capacity)
      await postVersion(branch, "capacity", { maxConcurrentOrders: 5 });
    setMessage("Базовые версии возможностей опубликованы.");
    await load();
  };
  const pauseForHour = async (branch: Branch) => {
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    await postVersion(branch, "availability", {
      kind: "UNAVAILABLE",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    setMessage("Филиал временно недоступен на один час.");
    await load();
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Производственная сеть</p>
      <h1>{workspace?.displayName ?? "Профиль студии"}</h1>
      <p>Статус: {workspace?.status ?? "загрузка"}</p>
      <section className="panel review-list">
        {workspace?.branches.map((branch) => (
          <article key={branch.id}>
            <h2>{branch.name}</h2>
            <p>
              {branch.active ? "Филиал активен" : "Филиал отключён"} ·{" "}
              {branch.timezone}
            </p>
            <p>
              Возможности v{branch.capability?.version ?? "—"}; каталог v
              {branch.catalog?.version ?? "—"}; график v
              {branch.operational?.version ?? "—"}; лимит:{" "}
              {branch.capacity?.maxConcurrentOrders ?? "—"}
            </p>
            <button className="button secondary" onClick={() => toggle(branch)}>
              {branch.acceptingOrders
                ? "Приостановить новые заказы"
                : "Возобновить приём"}
            </button>
            {(!branch.capability ||
              !branch.catalog ||
              !branch.capacity ||
              !branch.operational) && (
              <button
                className="button primary"
                onClick={() => configure(branch)}
              >
                Создать базовую конфигурацию
              </button>
            )}{" "}
            <button
              className="button secondary"
              onClick={() => pauseForHour(branch)}
            >
              Недоступен 1 час
            </button>
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
