"use client";

import Link from "next/link";
import { customerCopy, useCustomerLocale } from "../lib/customer-i18n";

export default function HomePage() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  return (
    <main>
      <section className="hero">
        <div className="language" aria-label="Til / Язык">
          <Link href="/?lang=ru">RU</Link>
          <Link href="/?lang=uz">UZ</Link>
        </div>
        <p className="eyebrow">Ташкент · Toshkent</p>
        <h1>{text.hero}</h1>
        <p className="lead">{text.lead}</p>
        <div className="actions">
          <Link className="button primary" href={`/catalog?lang=${locale}`}>
            {text.start}
          </Link>
          <Link className="button secondary" href={`/orders?lang=${locale}`}>
            {text.orders}
          </Link>
        </div>
        <ol className="journey">
          <li>
            {locale === "uz" ? "Xizmat va parametrlar" : "Услуга и параметры"}
          </li>
          <li>{locale === "uz" ? "Fayl va maket" : "Файл и макет"}</li>
          <li>{locale === "uz" ? "Narx va to‘lov" : "Цена и оплата"}</li>
          <li>
            {locale === "uz" ? "Tayyorlash va olish" : "Печать и получение"}
          </li>
        </ol>
      </section>
      <section className="features">
        <article>
          <span>01</span>
          <h2>{locale === "uz" ? "Xavfsiz" : "Безопасно"}</h2>
          <p>
            {locale === "uz"
              ? "Fayllar yopiq saqlanadi va brauzer keshiga tushmaydi."
              : "Файлы хранятся приватно и не попадают в кэш браузера."}
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>{locale === "uz" ? "Tushunarli" : "Понятно"}</h2>
          <p>
            {locale === "uz"
              ? "Maket va yakuniy narx to‘lovdan oldin ko‘rinadi."
              : "Макет и итоговая цена известны до оплаты."}
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>{locale === "uz" ? "Yaqin" : "Рядом"}</h2>
          <p>
            {locale === "uz"
              ? "Mos studiya imkoniyat va bandlik bo‘yicha tanlanadi."
              : "Подходящая студия выбирается по возможностям и загрузке."}
          </p>
        </article>
      </section>
    </main>
  );
}
