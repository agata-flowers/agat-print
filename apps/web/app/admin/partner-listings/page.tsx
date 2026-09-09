"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Listing = {
  id: string;
  version: number;
  status: string;
  publicSlug: string;
  titleRu: string;
  titleUz: string;
  descriptionRu: string;
  descriptionUz: string;
  branchName: string;
  partnerName: string;
  partnerStatus: string;
  city: string;
  district: string | null;
};
export default function ListingModerationPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/admin/partner-listings");
      setListings(
        ((await response.json()) as { listings: Listing[] }).listings,
      );
    } catch {
      setMessage("Раздел доступен только администратору.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const decide = async (
    listing: Listing,
    decision: "PUBLISH" | "REJECT" | "RETIRE",
  ) => {
    await apiRequest(`/admin/partner-listings/${listing.id}/decision`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ decision, version: listing.version }),
    });
    await load();
  };
  return (
    <main className="narrow">
      <p className="eyebrow">Модерация</p>
      <h1>Карточки студий</h1>
      <section className="panel review-list">
        {listings.map((listing) => (
          <article key={listing.id}>
            <strong>
              {listing.titleRu} / {listing.titleUz}
            </strong>
            <p>
              {listing.partnerName} · {listing.branchName} · {listing.city}
              {listing.district ? ` · ${listing.district}` : ""}
            </p>
            <p>{listing.descriptionRu}</p>
            <p>{listing.descriptionUz}</p>
            <p>{listing.status}</p>
            {listing.status === "SUBMITTED" && (
              <>
                <button
                  className="button primary"
                  onClick={() => decide(listing, "PUBLISH")}
                >
                  Опубликовать
                </button>{" "}
                <button
                  className="button secondary"
                  onClick={() => decide(listing, "REJECT")}
                >
                  Отклонить
                </button>
              </>
            )}
            {listing.status === "PUBLISHED" && (
              <button
                className="button secondary"
                onClick={() => decide(listing, "RETIRE")}
              >
                Снять с публикации
              </button>
            )}
          </article>
        ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
