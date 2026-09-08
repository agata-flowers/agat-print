"use client";

import { useEffect, useState } from "react";
import { apiRequest, publicApiRequest } from "../../../lib/api";

const fields = [
  {
    code: "WIDTH_MM",
    labelRu: "Размер",
    labelUz: "O‘lcham",
    required: true,
    values: [{ code: "210", labelRu: "A4 — 210 мм", labelUz: "A4 — 210 mm" }],
  },
  {
    code: "HEIGHT_MM",
    labelRu: "Высота",
    labelUz: "Balandlik",
    required: true,
    values: [{ code: "297", labelRu: "A4 — 297 мм", labelUz: "A4 — 297 mm" }],
  },
  {
    code: "MIN_DPI",
    labelRu: "Качество",
    labelUz: "Sifat",
    required: true,
    values: [{ code: "300", labelRu: "Стандартное", labelUz: "Standart" }],
  },
  {
    code: "PAPER",
    labelRu: "Бумага",
    labelUz: "Qog‘oz",
    required: true,
    values: [{ code: "STANDARD", labelRu: "Стандартная", labelUz: "Standart" }],
  },
  {
    code: "COLOR",
    labelRu: "Цветность",
    labelUz: "Rang",
    required: true,
    values: [{ code: "COLOR", labelRu: "Цветная", labelUz: "Rangli" }],
  },
  {
    code: "PHOTO_DOCUMENT",
    labelRu: "Фото на документы",
    labelUz: "Hujjat uchun foto",
    required: true,
    values: [{ code: "NO", labelRu: "Нет", labelUz: "Yo‘q" }],
  },
];
const initialItems = [
  {
    serviceCode: "DOCUMENT_PRINT",
    slug: "document-print",
    titleRu: "Печать документов",
    titleUz: "Hujjatlarni chop etish",
    descriptionRu: "Печать PDF и DOCX",
    descriptionUz: "PDF va DOCX chop etish",
    acceptedFileKinds: ["PDF", "DOCX"],
    optionSchema: { fields },
    sortOrder: 10,
  },
  {
    serviceCode: "PHOTO_PRINT",
    slug: "photo-print",
    titleRu: "Печать фотографий",
    titleUz: "Fotosurat chop etish",
    descriptionRu: "Печать JPG и PNG",
    descriptionUz: "JPG va PNG chop etish",
    acceptedFileKinds: ["JPEG", "PNG"],
    optionSchema: { fields },
    sortOrder: 20,
  },
  {
    serviceCode: "ID_PHOTO",
    slug: "id-photo",
    titleRu: "Фото на документы",
    titleUz: "Hujjat uchun foto",
    descriptionRu: "Подготовка и печать фото",
    descriptionUz: "Suratni tayyorlash va chop etish",
    acceptedFileKinds: ["JPEG", "PNG"],
    optionSchema: { fields },
    sortOrder: 30,
  },
];

export default function AdminCatalogPage() {
  const [version, setVersion] = useState<number>();
  const [message, setMessage] = useState("");
  const load = async () => {
    const response = await publicApiRequest("/catalog?locale=ru");
    setVersion(((await response.json()) as { version: number }).version);
  };
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);
  const publish = async () => {
    try {
      const response = await apiRequest("/admin/catalog/versions", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ items: initialItems }),
      });
      setVersion(((await response.json()) as { version: number }).version);
      setMessage("Новая неизменяемая версия каталога опубликована.");
    } catch {
      setMessage(
        "Публикация недоступна. Проверьте роль администратора и данные.",
      );
    }
  };
  return (
    <main className="narrow">
      <p className="eyebrow">Администратор</p>
      <h1>Каталог услуг</h1>
      <section className="panel draft-flow">
        <p>Активная версия: {version ?? "не опубликована"}</p>
        {initialItems.map((item) => (
          <article key={item.serviceCode}>
            <strong>{item.titleRu}</strong>
            <p>{item.descriptionRu}</p>
          </article>
        ))}
        <button className="button primary" onClick={publish}>
          Опубликовать новую версию
        </button>
        <p aria-live="polite">{message}</p>
      </section>
    </main>
  );
}
