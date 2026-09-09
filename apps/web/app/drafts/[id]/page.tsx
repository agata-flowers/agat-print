"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest, apiUpload } from "../../../lib/api";
import {
  customerCopy,
  customerError,
  useCustomerLocale,
} from "../../../lib/customer-i18n";

type Draft = {
  id: string;
  version: number;
  service: { code: string; title: string };
  step: string;
  upload: null | {
    accepted: boolean;
    ready: boolean;
    errorCode: string | null;
  };
  layout: null | {
    presentation: string;
    previewAvailable: boolean;
    approved: boolean;
  };
  quote: null | { totalMinor: string; currency: string; active: boolean };
  orderPath: string | null;
  studioPreference: {
    mode: "AUTO_ASSIGN" | "PREFERRED_STUDIO";
    fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE" | "STRICT_PREFERENCE";
    studio: null | { slug: string; name: string };
  };
};

type Studio = {
  slug: string;
  name: string;
  city: string;
  district: string | null;
  openingState: string;
};

export default function DraftPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [draft, setDraft] = useState<Draft>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [selectedStudio, setSelectedStudio] = useState("");
  const [strict, setStrict] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await apiRequest(`/order-drafts/${id}`);
      const next = (await response.json()) as Draft;
      setDraft(next);
      setSelectedStudio(next.studioPreference.studio?.slug ?? "");
      setStrict(next.studioPreference.fallbackPolicy === "STRICT_PREFERENCE");
      if (!next.upload) {
        const studiosResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000"}/api/v1/studios?serviceCode=${encodeURIComponent(next.service.code)}&locale=${locale}`,
          { cache: "no-store" },
        );
        if (studiosResponse.ok)
          setStudios(
            ((await studiosResponse.json()) as { studios: Studio[] }).studios,
          );
      }
      if (next.orderPath)
        window.location.assign(`${next.orderPath}?lang=${locale}`);
      if (next.layout?.previewAvailable && !preview) {
        const signed = await apiRequest(`/order-drafts/${id}/preview-url`);
        setPreview(((await signed.json()) as { url: string }).url);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}&lang=${locale}`,
        );
        return;
      }
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "REQUEST_FAILED",
          locale,
        ),
      );
    }
  }, [id, locale, preview]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);
  const act = async (path: string, body: object) => {
    if (!draft) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiRequest(`/order-drafts/${id}/${path}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const next = (await response.json()) as Draft & {
        draftVersion?: number;
        totalMinor?: string;
        currency?: string;
        id?: string;
      };
      if (path === "checkout") {
        window.location.assign(`/orders/${next.id}?lang=${locale}`);
        return;
      }
      await load();
    } catch (error) {
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "REQUEST_FAILED",
          locale,
        ),
      );
      await load();
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!draft || !file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (
      !extension ||
      !["pdf", "docx", "jpg", "jpeg", "png"].includes(extension)
    ) {
      setMessage(customerError("UNSUPPORTED_FILE_EXTENSION", locale));
      return;
    }
    setBusy(true);
    try {
      await act("upload-session", {
        version: draft.version,
        extension,
        declaredMime: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      await apiUpload(`/order-drafts/${id}/content`, file);
      await load();
    } catch (error) {
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "UPLOAD_FAILED",
          locale,
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const saveStudio = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const response = await apiRequest(
        `/order-drafts/${id}/studio-preference`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            version: draft.version,
            mode: selectedStudio ? "PREFERRED_STUDIO" : "AUTO_ASSIGN",
            fallbackPolicy: strict
              ? "STRICT_PREFERENCE"
              : "ALLOW_ELIGIBLE_ALTERNATIVE",
            ...(selectedStudio ? { studioSlug: selectedStudio } : {}),
          }),
        },
      );
      await response.json();
      setMessage(text.studioSaved);
      await load();
    } catch (error) {
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "REQUEST_FAILED",
          locale,
        ),
      );
      await load();
    } finally {
      setBusy(false);
    }
  };
  if (!draft)
    return (
      <main className="narrow">
        <p>{message || text.processing}</p>
      </main>
    );
  return (
    <main className="narrow">
      <p className="eyebrow">{draft.service.title}</p>
      <h1>
        {draft.step === "file"
          ? text.file
          : draft.step === "checkout"
            ? text.checkout
            : text.configure}
      </h1>
      <section className="panel draft-flow">
        {!draft.upload && (
          <fieldset className="studio-choice">
            <legend>{text.studioChoice}</legend>
            <label>
              <input
                type="radio"
                name="studio"
                checked={!selectedStudio}
                onChange={() => setSelectedStudio("")}
              />{" "}
              {text.autoAssign}
            </label>
            {studios.map((studio) => (
              <label key={studio.slug}>
                <input
                  type="radio"
                  name="studio"
                  checked={selectedStudio === studio.slug}
                  onChange={() => setSelectedStudio(studio.slug)}
                />{" "}
                {studio.name} · {studio.district ?? studio.city}
              </label>
            ))}
            {selectedStudio && (
              <label>
                <input
                  type="checkbox"
                  checked={strict}
                  onChange={(event) => setStrict(event.target.checked)}
                />{" "}
                {strict ? text.strictPreference : text.allowFallback}
              </label>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={saveStudio}
            >
              {locale === "uz" ? "Tanlovni saqlash" : "Сохранить выбор"}
            </button>
          </fieldset>
        )}
        {!draft.upload && (
          <>
            <label className="file-picker">
              {text.file}
              <input
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
            <button
              className="button primary"
              disabled={!file || busy}
              onClick={upload}
            >
              {text.upload}
            </button>
          </>
        )}
        {draft.upload && !draft.upload.ready && (
          <p>{draft.upload.accepted ? text.processing : text.quality}</p>
        )}
        {draft.upload?.ready && !draft.layout && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => act("create-layout", { version: draft.version })}
          >
            {text.prepare}
          </button>
        )}
        {draft.layout?.presentation === "manual_review" && <p>{text.manual}</p>}
        {draft.layout?.presentation === "quality_error" && (
          <p className="notice error">{text.quality}</p>
        )}
        {preview && (
          <iframe className="preview-frame" src={preview} title={text.review} />
        )}
        {draft.layout?.presentation === "approval" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => act("approve", { version: draft.version })}
          >
            {text.approve}
          </button>
        )}
        {draft.layout?.approved && !draft.quote?.active && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => act("quote", { version: draft.version })}
          >
            {text.quote}
          </button>
        )}
        {draft.quote?.active && (
          <div className="quote">
            <span>{text.total}</span>
            <strong>
              {draft.quote.totalMinor} {draft.quote.currency}
            </strong>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => act("checkout", { version: draft.version })}
            >
              {text.checkout}
            </button>
          </div>
        )}
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
