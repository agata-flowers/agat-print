"use client";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest, publicApiRequest } from "../../lib/api";
import {
  customerCopy,
  customerError,
  useCustomerLocale,
} from "../../lib/customer-i18n";

type OptionValue = { code: string; labelRu: string; labelUz: string };
type OptionField = {
  code: string;
  labelRu: string;
  labelUz: string;
  required: boolean;
  values: OptionValue[];
};
type Service = {
  slug: string;
  title: string;
  description: string;
  options: { fields: OptionField[] };
};

export default function NewOrderPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(
    () => setSlug(new URLSearchParams(window.location.search).get("service")),
    [],
  );
  const [service, setService] = useState<Service>();
  const [configuration, setConfiguration] = useState<Record<string, string>>(
    {},
  );
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void publicApiRequest(`/catalog?locale=${locale}`)
      .then(async (response) => {
        const items = ((await response.json()) as { services: Service[] })
          .services;
        const selected = items.find((item) => item.slug === slug);
        setService(selected);
        if (selected)
          setConfiguration(
            Object.fromEntries(
              selected.options.fields.map((field) => [
                field.code,
                field.values[0]?.code ?? "",
              ]),
            ),
          );
      })
      .catch(() => setMessage(customerError("REQUEST_FAILED", locale)));
  }, [locale, slug]);
  const valid = useMemo(
    () =>
      Boolean(service) &&
      service!.options.fields.every(
        (field) => !field.required || configuration[field.code],
      ),
    [configuration, service],
  );
  const submit = async () => {
    if (!service || !valid) return;
    setMessage("");
    try {
      const response = await apiRequest("/order-drafts", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          serviceSlug: service.slug,
          locale,
          configuration,
          quantity,
        }),
      });
      const body = (await response.json()) as { id: string };
      window.location.assign(`/drafts/${body.id}?lang=${locale}`);
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
  };
  return (
    <main className="narrow">
      <p className="eyebrow">{text.catalog}</p>
      <h1>{text.configure}</h1>
      {service ? (
        <section className="panel auth-form">
          <h2>{service.title}</h2>
          <p>{service.description}</p>
          {service.options.fields.map((field) => (
            <label key={field.code}>
              {locale === "uz" ? field.labelUz : field.labelRu}
              <select
                value={configuration[field.code] ?? ""}
                onChange={(event) =>
                  setConfiguration((current) => ({
                    ...current,
                    [field.code]: event.target.value,
                  }))
                }
              >
                {field.values.map((value) => (
                  <option key={value.code} value={value.code}>
                    {locale === "uz" ? value.labelUz : value.labelRu}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            {text.quantity}
            <input
              type="number"
              min={1}
              max={10000}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!valid}
            onClick={submit}
          >
            {text.continue}
          </button>
          <p aria-live="polite">{message}</p>
        </section>
      ) : (
        <p>
          {message ||
            (locale === "uz" ? "Xizmat topilmadi." : "Услуга не найдена.")}
        </p>
      )}
    </main>
  );
}
