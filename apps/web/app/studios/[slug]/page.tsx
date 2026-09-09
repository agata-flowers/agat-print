"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { publicApiRequest } from "../../../lib/api";
import { useCustomerLocale } from "../../../lib/customer-i18n";

type Studio = {
  slug: string;
  name: string;
  description: string;
  city: string;
  district: string | null;
  openingState: string;
  services: string[];
};
export default function StudioPage() {
  const { slug } = useParams<{ slug: string }>();
  const locale = useCustomerLocale();
  const [studio, setStudio] = useState<Studio>();
  useEffect(() => {
    void publicApiRequest(`/studios/${slug}?locale=${locale}`)
      .then((response) => response.json())
      .then((body: Studio) => setStudio(body));
  }, [locale, slug]);
  return (
    <main className="narrow">
      <p className="eyebrow">
        {studio?.city}
        {studio?.district ? ` · ${studio.district}` : ""}
      </p>
      <h1>{studio?.name ?? (locale === "uz" ? "Studiya" : "Студия")}</h1>
      <section className="panel">
        <p>{studio?.description}</p>
        <p>
          {locale === "uz" ? "Xizmatlar" : "Услуги"}:{" "}
          {studio?.services.join(" · ")}
        </p>
        <p>
          {locale === "uz"
            ? "Ko‘rsatilgan mavjudlik taxminiy. Buyurtma to‘lovdan keyin tekshiriladi."
            : "Доступность ориентировочная. Возможность выполнения проверяется после оплаты."}
        </p>
        <Link className="button primary" href={`/catalog?lang=${locale}`}>
          {locale === "uz" ? "Buyurtma yaratish" : "Создать заказ"}
        </Link>
      </section>
    </main>
  );
}
