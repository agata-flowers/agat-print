"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "../../lib/api";
import {
  customerCopy,
  customerError,
  useCustomerLocale,
} from "../../lib/customer-i18n";

type Basket = {
  id: string;
  presentation: "building" | "review" | "order" | "closed";
  version: number;
  itemCount: number;
  items: Array<{
    id: string;
    sequence: number;
    draftId: string;
    title: string;
    quantity: number;
    ready: boolean;
  }>;
  quote: null | { totalMinor: string; currency: string; expiresAt: string };
  order: null | { id: string; status: string };
};

const key = () => crypto.randomUUID();

export default function BasketPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [basket, setBasket] = useState<Basket | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState("");
  const [configured, setConfigured] = useState(false);
  const added = useRef(false);

  const load = useCallback(async () => {
    const response = await apiRequest("/baskets");
    const rows = ((await response.json()) as { baskets: Basket[] }).baskets;
    let current = rows.find(
      (row) => row.presentation === "building" || row.presentation === "review",
    );
    if (!current) {
      const created = await apiRequest("/baskets", {
        method: "POST",
        headers: { "Idempotency-Key": key() },
        body: JSON.stringify({ locale }),
      });
      current = (await created.json()) as Basket;
    }
    const draftId = new URLSearchParams(window.location.search).get("add");
    if (
      draftId &&
      !added.current &&
      !current.items.some((item) => item.draftId === draftId)
    ) {
      added.current = true;
      const response = await apiRequest(`/baskets/${current.id}/items`, {
        method: "POST",
        headers: { "Idempotency-Key": key() },
        body: JSON.stringify({ version: current.version, draftId }),
      });
      current = (await response.json()) as Basket;
      window.history.replaceState({}, "", `/basket?lang=${locale}`);
    }
    setBasket(current);
  }, [locale]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(
          `/login?next=${encodeURIComponent(`/basket?lang=${locale}`)}&lang=${locale}`,
        );
        return;
      }
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "REQUEST_FAILED",
          locale,
        ),
      );
    });
  }, [load, locale]);

  const mutate = async (
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) => {
    if (!basket) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiRequest(`/baskets/${basket.id}${path}`, {
        method,
        headers: { "Idempotency-Key": key() },
        body: JSON.stringify({ version: basket.version, ...body }),
      });
      const next = (await response.json()) as Basket & { id: string };
      if (path === "/checkout") {
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
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const configure = async () => {
    if (!basket) return;
    setBusy(true);
    setMessage("");
    try {
      const studioResponse = await apiRequest(
        `/baskets/${basket.id}/studio-preference`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": key() },
          body: JSON.stringify({
            version: basket.version,
            mode: "AUTO_ASSIGN",
            fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
          }),
        },
      );
      const afterStudio = (await studioResponse.json()) as Basket;
      const fulfillmentResponse = await apiRequest(
        `/baskets/${basket.id}/fulfillment-preference`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": key() },
          body: JSON.stringify({
            version: afterStudio.version,
            mode: delivery ? "DELIVERY" : "PICKUP",
            locationCode: delivery ? "TASHKENT_CENTRAL" : "PICKUP",
            address: delivery ? address : undefined,
          }),
        },
      );
      setBasket((await fulfillmentResponse.json()) as Basket);
      setConfigured(true);
    } catch (error) {
      setMessage(
        customerError(
          error instanceof ApiError ? error.code : "REQUEST_FAILED",
          locale,
        ),
      );
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!basket)
    return (
      <main className="narrow">
        <p>{message || "…"}</p>
      </main>
    );

  return (
    <main className="narrow" data-testid="stage15-basket">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.basket}</h1>
      <section className="review-list">
        {basket.items.length === 0 && <p>{text.basketEmpty}</p>}
        {basket.items.map((item) => (
          <article
            className="order-card"
            key={item.id}
            data-testid="basket-item"
          >
            <strong>
              {item.sequence}. {item.title}
            </strong>
            <span>
              {text.quantity}: {item.quantity}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => mutate(`/items/${item.id}`, "DELETE", {})}
            >
              {text.removeItem}
            </button>
          </article>
        ))}
      </section>
      <div className="actions">
        <Link className="button secondary" href={`/catalog?lang=${locale}`}>
          {text.addAnother}
        </Link>
      </div>
      {basket.items.length > 0 && !basket.quote && (
        <section className="quote">
          <label>
            <input
              type="radio"
              checked={!delivery}
              onChange={() => setDelivery(false)}
            />{" "}
            {text.basketPickup}
          </label>
          <label>
            <input
              type="radio"
              checked={delivery}
              onChange={() => setDelivery(true)}
            />{" "}
            {text.basketDelivery}
          </label>
          {delivery && (
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={500}
              autoComplete="street-address"
              aria-label={text.basketAddress}
            />
          )}
          <button
            className="button primary"
            disabled={busy || (delivery && address.trim().length < 5)}
            onClick={configure}
          >
            {text.continue}
          </button>
          {configured && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => mutate("/quote", "POST", {})}
            >
              {text.basketQuote}
            </button>
          )}
        </section>
      )}
      {basket.quote && (
        <section className="quote">
          <span>{text.total}</span>
          <strong>
            {basket.quote.totalMinor} {basket.quote.currency}
          </strong>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => mutate("/checkout", "POST", {})}
          >
            {text.basketCheckout}
          </button>
        </section>
      )}
      <p aria-live="polite">{message}</p>
    </main>
  );
}
