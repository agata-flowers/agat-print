"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { publicApiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";
import { LanguageSwitcher } from "../../components/language-switcher";
type Service = {
  slug: string;
  title: string;
  description: string;
  acceptedFileKinds: string[];
};
export default function CatalogPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [services, setServices] = useState<Service[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void publicApiRequest(`/catalog?locale=${locale}`)
      .then(async (response) =>
        setServices(
          ((await response.json()) as { services: Service[] }).services,
        ),
      )
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, [locale]);
  return (
    <main className="narrow wide-mobile flow-page">
      <LanguageSwitcher />
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.choose}</h1>
      <p className="lead small">
        {locale === "uz"
          ? "Kerakli xizmatni tanlang — keyingi qadamda bosma parametrlarini sozlaysiz."
          : locale === "en"
            ? "Choose a service, then configure the print options in the next step."
            : "Выберите услугу — параметры печати можно настроить на следующем шаге."}
      </p>
      {unavailable && <p className="notice error">{text.serviceUnavailable}</p>}
      {loading && (
        <div className="loading-card" aria-label={text.loadingServices} />
      )}
      <section className="service-grid">
        {services.map((service, index) => (
          <article
            className={`service-card tone-${(index % 3) + 1}`}
            key={service.slug}
          >
            <span className="service-icon" aria-hidden="true">
              {service.acceptedFileKinds.includes("PDF") ? "Aa" : "◫"}
            </span>
            <h2>{service.title}</h2>
            <p>{service.description}</p>
            <small>{service.acceptedFileKinds.join(" · ")}</small>
            <Link
              className="button primary"
              href={`/new-order?service=${encodeURIComponent(service.slug)}&lang=${locale}`}
            >
              {text.continue}
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
