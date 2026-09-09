"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { publicApiRequest } from "../../lib/api";
import { customerCopy, useCustomerLocale } from "../../lib/customer-i18n";

type Studio = {
  slug: string;
  name: string;
  description: string;
  city: string;
  district: string | null;
  openingState: "open" | "closed";
  services: string[];
  distanceBand: "near" | "city" | "far" | null;
};

export default function StudiosPage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("locale", locale);
    publicApiRequest(`/studios?${params.toString()}`)
      .then((response) => response.json())
      .then((body: { studios: Studio[] }) => setStudios(body.studios))
      .catch(() =>
        setMessage(
          locale === "uz"
            ? "Studiyalarni yuklab bo‘lmadi. Qayta urinib ko‘ring."
            : "Не удалось загрузить студии. Попробуйте ещё раз.",
        ),
      );
  }, [locale]);
  return (
    <main className="narrow">
      <p className="eyebrow">AGAT PRINT</p>
      <h1>{text.studios}</h1>
      <p>
        {locale === "uz"
          ? "Faqat tekshirilgan va buyurtma qabul qilayotgan studiyalar ko‘rsatiladi."
          : "Показываем только проверенные студии, принимающие заказы."}
      </p>
      <section className="service-grid">
        {studios.map((studio) => (
          <article className="service-card" key={studio.slug}>
            <h2>{studio.name}</h2>
            <p>{studio.description}</p>
            <small>
              {studio.city}
              {studio.district ? ` · ${studio.district}` : ""} ·{" "}
              {studio.openingState === "open"
                ? locale === "uz"
                  ? "ochiq"
                  : "открыто"
                : locale === "uz"
                  ? "yopiq"
                  : "закрыто"}
            </small>
            <Link
              className="button secondary"
              href={`/studios/${studio.slug}?lang=${locale}`}
            >
              {locale === "uz" ? "Batafsil" : "Подробнее"}
            </Link>
          </article>
        ))}
        {!studios.length && (
          <p>
            {message ||
              (locale === "uz"
                ? "Mos studiyalar hozircha yo‘q."
                : "Подходящих студий пока нет.")}
          </p>
        )}
      </section>
    </main>
  );
}
