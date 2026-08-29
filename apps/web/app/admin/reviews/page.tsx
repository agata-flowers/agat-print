"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Review = {
  id: string;
  layoutId: string;
  reason: string;
  createdAt: string;
};

export default function ManualReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const response = await apiRequest("/admin/manual-reviews");
      setReviews((await response.json()) as Review[]);
    } catch {
      setMessage("Очередь доступна только администратору.");
    }
  };
  useEffect(() => void load(), []);

  const show = async (id: string) => {
    const response = await apiRequest(
      `/admin/manual-reviews/${id}/preview-url`,
    );
    setPreviewUrl(((await response.json()) as { url: string }).url);
  };
  const decide = async (id: string, decision: "APPROVE" | "REJECT") => {
    await apiRequest(`/admin/manual-reviews/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    setPreviewUrl(undefined);
    await load();
  };

  return (
    <main className="narrow">
      <p className="eyebrow">RBAC: ADMIN</p>
      <h1>Ручная проверка</h1>
      <div className="review-list">
        {reviews.map((review) => (
          <article className="panel" key={review.id}>
            <h2>Проверка фотографии</h2>
            <p>Причина: {review.reason}</p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => show(review.id)}
                type="button"
              >
                Открыть
              </button>
              <button
                className="button primary"
                onClick={() => decide(review.id, "APPROVE")}
                type="button"
              >
                Одобрить
              </button>
              <button
                className="button secondary"
                onClick={() => decide(review.id, "REJECT")}
                type="button"
              >
                Отклонить
              </button>
            </div>
          </article>
        ))}
      </div>
      {previewUrl && (
        <iframe
          className="preview-frame"
          src={previewUrl}
          title="Макет на ручной проверке"
        />
      )}
      <p aria-live="polite">{message}</p>
    </main>
  );
}
