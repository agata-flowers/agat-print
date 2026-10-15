"use client";

import Link from "next/link";
import { getPreviewCopy } from "@agat/i18n";
import { customerCopy, useCustomerLocale } from "../lib/customer-i18n";
import { LanguageSwitcher } from "../components/language-switcher";

export default function HomePage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const preview = getPreviewCopy(locale);
  return (
    <main>
      <section className="home-screen">
        <div className="home-language">
          <LanguageSwitcher />
        </div>
        <section className="hero-card">
          <div className="hero-copy">
            <span className="eyebrow">{preview.eyebrow}</span>
            <h1>{text.hero}</h1>
            <p>{text.lead}</p>
            <div className="actions">
              <Link
                className="button hero-action"
                href={`/catalog?lang=${locale}`}
              >
                {text.start} <span aria-hidden="true">→</span>
              </Link>
              <Link
                className="button hero-secondary"
                href={`/orders?lang=${locale}`}
              >
                {text.orders}
              </Link>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="paper-stack paper-back" />
            <div className="paper-stack paper-front">
              <span>AGAT</span>
              <div />
              <div />
              <small>PRINT</small>
            </div>
            <div className="hero-seal">A</div>
          </div>
        </section>
        <div className="trust-row">
          <span>⌁ {preview.heroTrust}</span>
          <span>◇ {preview.heroPrice}</span>
          <span>↻ {preview.heroResume}</span>
        </div>
        <section className="section-heading">
          <div>
            <span className="eyebrow">{preview.allServices}</span>
            <h2>{preview.popular}</h2>
          </div>
          <Link className="text-action" href={`/catalog?lang=${locale}`}>
            {preview.allServices} <span aria-hidden="true">→</span>
          </Link>
        </section>
        <section className="features">
          {[
            [preview.documentPrint, preview.documentPrintText, "Aa"],
            [preview.photoPrint, preview.photoPrintText, "◫"],
            [preview.idPhoto, preview.idPhotoText, "◎"],
          ].map(([title, description, icon]) => (
            <article key={title}>
              <span className="service-icon" aria-hidden="true">
                {icon}
              </span>
              <h2>{title}</h2>
              <p>{description}</p>
            </article>
          ))}
        </section>
        <div className="home-studio-link">
          <Link className="button secondary" href={`/studios?lang=${locale}`}>
            {text.studios}
          </Link>
        </div>
      </section>
    </main>
  );
}
