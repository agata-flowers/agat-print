"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";

type Listing = {
  id: string;
  version: number;
  publicSlug: string;
  status: string;
  titleRu: string;
  titleUz: string;
  descriptionRu: string;
  descriptionUz: string;
};
type Branch = { branchId: string; branchName: string; listings: Listing[] };
export default function PartnerListingPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [slug, setSlug] = useState("");
  const [titleRu, setTitleRu] = useState("");
  const [titleUz, setTitleUz] = useState("");
  const [descriptionRu, setDescriptionRu] = useState("");
  const [descriptionUz, setDescriptionUz] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest("/partner/network/listing");
      const body = (await response.json()) as { branches: Branch[] };
      setBranches(body.branches);
      setBranchId((value) => value || body.branches[0]?.branchId || "");
    } catch {
      setMessage("Раздел доступен только владельцу активной студии.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const save = async () => {
    await apiRequest("/partner/network/listing/draft", {
      method: "PUT",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        branchId,
        publicSlug: slug,
        titleRu,
        titleUz,
        descriptionRu,
        descriptionUz,
      }),
    });
    setMessage("Черновик сохранён.");
    await load();
  };
  const submit = async (listing: Listing) => {
    await apiRequest(`/partner/network/listing/${listing.id}/submit`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ version: listing.version }),
    });
    setMessage("Карточка отправлена на модерацию.");
    await load();
  };
  return (
    <main className="narrow">
      <p className="eyebrow">Публичная карточка</p>
      <h1>Студия в каталоге</h1>
      <section className="auth-form">
        <label>
          Филиал
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.branchId} value={branch.branchId}>
                {branch.branchName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Адрес страницы
          <input
            value={slug}
            onChange={(event) =>
              setSlug(
                event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
          />
        </label>
        <label>
          Название на русском
          <input
            value={titleRu}
            onChange={(event) => setTitleRu(event.target.value)}
          />
        </label>
        <label>
          Nomi o‘zbekcha
          <input
            value={titleUz}
            onChange={(event) => setTitleUz(event.target.value)}
          />
        </label>
        <label>
          Описание на русском
          <input
            value={descriptionRu}
            onChange={(event) => setDescriptionRu(event.target.value)}
          />
        </label>
        <label>
          O‘zbekcha tavsif
          <input
            value={descriptionUz}
            onChange={(event) => setDescriptionUz(event.target.value)}
          />
        </label>
        <button className="button primary" onClick={save}>
          Сохранить черновик
        </button>
        {branches
          .flatMap((branch) => branch.listings)
          .map((listing) => (
            <article className="notice" key={listing.id}>
              <strong>{listing.titleRu}</strong>
              <p>{listing.status}</p>
              {listing.status === "DRAFT" && (
                <button
                  className="button secondary"
                  onClick={() => submit(listing)}
                >
                  Отправить
                </button>
              )}
            </article>
          ))}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
