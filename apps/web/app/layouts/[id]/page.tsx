"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type LayoutView = {
  id: string;
  status: string;
  latestPreviewId: string | null;
  qualityCode: string | null;
  approved: boolean;
};

const statusText: Record<string, string> = {
  PROCESSING: "Подготавливаем макет",
  QUALITY_CHECK_FAILED: "Нужен другой файл",
  MANUAL_REVIEW_REQUIRED: "Макет ожидает ручной проверки",
  AWAITING_APPROVAL: "Макет готов к проверке",
  APPROVED: "Макет подтверждён",
};

export default function LayoutPage() {
  const { id } = useParams<{ id: string }>();
  const [layout, setLayout] = useState<LayoutView>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiRequest(`/layouts/${id}`);
        const next = (await response.json()) as LayoutView;
        if (!active) return;
        setLayout(next);
        if (["AWAITING_APPROVAL", "APPROVED"].includes(next.status)) {
          const signed = await apiRequest(`/layouts/${id}/preview-url`);
          const body = (await signed.json()) as { url: string };
          if (active) setPreviewUrl(body.url);
        }
      } catch {
        if (active) setMessage("Макет недоступен или не принадлежит вам.");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [id]);

  const confirm = async () => {
    if (!layout?.latestPreviewId) return;
    try {
      const response = await apiRequest(`/layouts/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ previewVersionId: layout.latestPreviewId }),
      });
      setLayout((await response.json()) as LayoutView);
      setMessage("Актуальная версия макета подтверждена.");
    } catch {
      setMessage(
        "Версия макета изменилась. Обновите страницу и проверьте её снова.",
      );
    }
  };

  return (
    <main className="narrow">
      <p className="eyebrow">Защищённый просмотр</p>
      <h1>{statusText[layout?.status ?? "PROCESSING"] ?? "Макет"}</h1>
      <section className="panel layout-panel">
        {layout?.status === "PROCESSING" && (
          <p>Проверяем файл и параметры печати.</p>
        )}
        {layout?.status === "QUALITY_CHECK_FAILED" && (
          <p>
            Автоматическая проверка не пройдена. Код:{" "}
            {layout.qualityCode ?? "QUALITY_CHECK_FAILED"}.
          </p>
        )}
        {layout?.status === "MANUAL_REVIEW_REQUIRED" && (
          <p>
            Оператор проверит фон, положение головы, размер и качество
            фотографии.
          </p>
        )}
        {previewUrl && (
          <iframe
            className="preview-frame"
            src={previewUrl}
            title="Макет документа"
          />
        )}
        {layout?.status === "AWAITING_APPROVAL" && (
          <button className="button primary" onClick={confirm} type="button">
            Подтвердить эту версию
          </button>
        )}
        {layout?.approved && <p>Подтверждение сохранено для текущей версии.</p>}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
