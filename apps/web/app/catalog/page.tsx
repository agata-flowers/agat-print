"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { publicApiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";
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
  useEffect(() => {
    void publicApiRequest(`/catalog?locale=${locale}`)
      .then(async (response) =>
        setServices(
          ((await response.json()) as { services: Service[] }).services,
        ),
      )
      .catch(() => setUnavailable(true));
  }, [locale]);
  return (
    <main className="narrow wide-mobile">
      <div className="language">
        <Link href="/catalog?lang=ru">RU</Link>
        <Link href="/catalog?lang=uz">UZ</Link>
      </div>
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.choose}</h1>
      {unavailable && (
        <p className="notice error">
          {locale === "uz"
            ? "Xizmatlar vaqtincha mavjud emas."
            : "Услуги временно недоступны."}
        </p>
      )}
      <section className="service-grid">
        {services.map((service) => (
          <article className="service-card" key={service.slug}>
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
