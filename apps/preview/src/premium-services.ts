import type { CustomerLocale } from "@agat/i18n";
import type { LocalizedText, PremiumCategory } from "./premium-data";

export type ServiceId = Extract<
  PremiumCategory,
  | "id-photo"
  | "printing"
  | "outdoor"
  | "presentations"
  | "coursework"
  | "design"
>;

export type ServiceField = {
  id: string;
  type: "select" | "number" | "text" | "file";
  label: LocalizedText;
  options?: Array<{ value: string; label: LocalizedText; multiplier?: number }>;
  min?: number;
  max?: number;
  required?: boolean;
};

export type PremiumService = {
  id: ServiceId;
  title: LocalizedText;
  subtitle: LocalizedText;
  turnaround: LocalizedText;
  basePrice: number;
  accent: string;
  icon: "portrait" | "printer" | "billboard" | "slides" | "book" | "pen";
  fields: ServiceField[];
};

const choice = (
  value: string,
  ru: string,
  uz: string,
  en: string,
  multiplier = 1,
) => ({ value, label: { ru, uz, en }, multiplier });

export const premiumServices: PremiumService[] = [
  {
    id: "id-photo",
    title: {
      ru: "Фото на документы",
      uz: "Hujjat uchun foto",
      en: "ID photos",
    },
    subtitle: {
      ru: "Проверка кадра, фон и готовый комплект",
      uz: "Kadr tekshiruvi, fon va tayyor to‘plam",
      en: "Framing check, background and a ready set",
    },
    turnaround: {
      ru: "от 15 минут",
      uz: "15 daqiqadan",
      en: "from 15 minutes",
    },
    basePrice: 25_000,
    accent: "#f1d7ff",
    icon: "portrait",
    fields: [
      {
        id: "document",
        type: "select",
        required: true,
        label: { ru: "Тип документа", uz: "Hujjat turi", en: "Document type" },
        options: [
          choice("passport", "Паспорт 3×4", "Pasport 3×4", "Passport 3×4"),
          choice("visa", "Виза 35×45", "Viza 35×45", "Visa 35×45", 1.2),
          choice(
            "custom",
            "Другой формат",
            "Boshqa format",
            "Custom format",
            1.35,
          ),
        ],
      },
      {
        id: "photo",
        type: "file",
        required: true,
        label: {
          ru: "Портретное фото",
          uz: "Portret surati",
          en: "Portrait photo",
        },
      },
      {
        id: "sets",
        type: "number",
        required: true,
        min: 1,
        max: 10,
        label: {
          ru: "Количество комплектов",
          uz: "To‘plamlar soni",
          en: "Number of sets",
        },
      },
    ],
  },
  {
    id: "printing",
    title: {
      ru: "Распечатка документов",
      uz: "Hujjatlarni chop etish",
      en: "Document printing",
    },
    subtitle: {
      ru: "PDF, DOCX и фотографии — с настройкой печати",
      uz: "PDF, DOCX va suratlar — bosma sozlamalari bilan",
      en: "PDF, DOCX and photos with print settings",
    },
    turnaround: {
      ru: "от 10 минут",
      uz: "10 daqiqadan",
      en: "from 10 minutes",
    },
    basePrice: 2_500,
    accent: "#d9eaff",
    icon: "printer",
    fields: [
      {
        id: "document",
        type: "file",
        required: true,
        label: {
          ru: "Файл для печати",
          uz: "Chop etish fayli",
          en: "File to print",
        },
      },
      {
        id: "color",
        type: "select",
        required: true,
        label: { ru: "Цветность", uz: "Rang", en: "Color mode" },
        options: [
          choice("mono", "Чёрно-белая", "Oq-qora", "Black & white"),
          choice("color", "Цветная", "Rangli", "Color", 2.4),
        ],
      },
      {
        id: "paper",
        type: "select",
        required: true,
        label: { ru: "Бумага", uz: "Qog‘oz", en: "Paper" },
        options: [
          choice("a4", "A4 · 80 г/м²", "A4 · 80 g/m²", "A4 · 80 gsm"),
          choice("photo", "Фотобумага", "Fotoqog‘oz", "Photo paper", 3.2),
        ],
      },
      {
        id: "copies",
        type: "number",
        required: true,
        min: 1,
        max: 100,
        label: { ru: "Копии", uz: "Nusxalar", en: "Copies" },
      },
    ],
  },
  {
    id: "outdoor",
    title: {
      ru: "Наружная реклама",
      uz: "Tashqi reklama",
      en: "Outdoor advertising",
    },
    subtitle: {
      ru: "Баннеры, постеры и вывески",
      uz: "Bannerlar, posterlar va peshlavhalar",
      en: "Banners, posters and signs",
    },
    turnaround: { ru: "от 1 дня", uz: "1 kundan", en: "from 1 day" },
    basePrice: 85_000,
    accent: "#ffe2c7",
    icon: "billboard",
    fields: [
      {
        id: "design",
        type: "file",
        required: true,
        label: {
          ru: "Готовый макет",
          uz: "Tayyor maket",
          en: "Print-ready artwork",
        },
      },
      {
        id: "width",
        type: "number",
        required: true,
        min: 30,
        max: 500,
        label: { ru: "Ширина, см", uz: "Eni, sm", en: "Width, cm" },
      },
      {
        id: "height",
        type: "number",
        required: true,
        min: 30,
        max: 500,
        label: { ru: "Высота, см", uz: "Balandligi, sm", en: "Height, cm" },
      },
      {
        id: "finish",
        type: "select",
        required: true,
        label: { ru: "Материал", uz: "Material", en: "Material" },
        options: [
          choice(
            "banner",
            "Баннер 440 г/м²",
            "Banner 440 g/m²",
            "440 gsm banner",
          ),
          choice(
            "poster",
            "Постерная бумага",
            "Poster qog‘ozi",
            "Poster paper",
            0.75,
          ),
        ],
      },
    ],
  },
  {
    id: "presentations",
    title: {
      ru: "Презентации и рефераты",
      uz: "Taqdimot va referatlar",
      en: "Presentations & reports",
    },
    subtitle: {
      ru: "Аккуратная структура и визуальная подача",
      uz: "Aniq tuzilma va vizual taqdimot",
      en: "Clear structure and visual storytelling",
    },
    turnaround: { ru: "от 2 дней", uz: "2 kundan", en: "from 2 days" },
    basePrice: 120_000,
    accent: "#e8ddff",
    icon: "slides",
    fields: [
      {
        id: "brief",
        type: "file",
        required: true,
        label: {
          ru: "Материалы и задание",
          uz: "Material va topshiriq",
          en: "Materials and brief",
        },
      },
      {
        id: "topic",
        type: "text",
        required: true,
        label: { ru: "Тема", uz: "Mavzu", en: "Topic" },
      },
      {
        id: "pages",
        type: "number",
        required: true,
        min: 5,
        max: 60,
        label: {
          ru: "Слайды / страницы",
          uz: "Slaydlar / sahifalar",
          en: "Slides / pages",
        },
      },
      {
        id: "level",
        type: "select",
        required: true,
        label: {
          ru: "Уровень оформления",
          uz: "Dizayn darajasi",
          en: "Design level",
        },
        options: [
          choice("clean", "Чистый", "Sodda", "Clean"),
          choice("premium", "Премиум", "Premium", "Premium", 1.65),
        ],
      },
    ],
  },
  {
    id: "coursework",
    title: { ru: "Курсовые работы", uz: "Kurs ishlari", en: "Coursework" },
    subtitle: {
      ru: "Печать, проверка полей и переплёт",
      uz: "Chop etish, maydonlarni tekshirish va muqova",
      en: "Print, margin check and binding",
    },
    turnaround: { ru: "от 3 часов", uz: "3 soatdan", en: "from 3 hours" },
    basePrice: 74_000,
    accent: "#fff0bd",
    icon: "book",
    fields: [
      {
        id: "document",
        type: "file",
        required: true,
        label: { ru: "Файл работы", uz: "Ish fayli", en: "Coursework file" },
      },
      {
        id: "pages",
        type: "number",
        required: true,
        min: 10,
        max: 200,
        label: { ru: "Страницы", uz: "Sahifalar", en: "Pages" },
      },
      {
        id: "binding",
        type: "select",
        required: true,
        label: { ru: "Переплёт", uz: "Muqova", en: "Binding" },
        options: [
          choice("soft", "Мягкий", "Yumshoq", "Soft"),
          choice("hard", "Твёрдый", "Qattiq", "Hard", 1.8),
        ],
      },
      {
        id: "copies",
        type: "number",
        required: true,
        min: 1,
        max: 10,
        label: { ru: "Экземпляры", uz: "Nusxalar", en: "Copies" },
      },
    ],
  },
  {
    id: "design",
    title: {
      ru: "Графический дизайн",
      uz: "Grafik dizayn",
      en: "Graphic design",
    },
    subtitle: {
      ru: "Логотипы, афиши и макеты для печати",
      uz: "Logotip, afisha va bosma maketlar",
      en: "Logos, posters and print artwork",
    },
    turnaround: { ru: "от 2 дней", uz: "2 kundan", en: "from 2 days" },
    basePrice: 349_000,
    accent: "#ffd8e2",
    icon: "pen",
    fields: [
      {
        id: "type",
        type: "select",
        required: true,
        label: {
          ru: "Что разработать",
          uz: "Nima ishlab chiqiladi",
          en: "Design type",
        },
        options: [
          choice("logo", "Логотип", "Logotip", "Logo"),
          choice("poster", "Афиша", "Afisha", "Poster", 0.75),
          choice(
            "layout",
            "Макет для печати",
            "Bosma maketi",
            "Print layout",
            0.6,
          ),
        ],
      },
      {
        id: "brief",
        type: "text",
        required: true,
        label: {
          ru: "Краткое описание",
          uz: "Qisqa tavsif",
          en: "Short brief",
        },
      },
      {
        id: "reference",
        type: "file",
        label: {
          ru: "Референс (необязательно)",
          uz: "Namuna (ixtiyoriy)",
          en: "Reference (optional)",
        },
      },
      {
        id: "concepts",
        type: "number",
        required: true,
        min: 1,
        max: 5,
        label: {
          ru: "Количество концепций",
          uz: "Konsepsiyalar soni",
          en: "Concepts",
        },
      },
    ],
  },
];

export const serviceText = {
  ru: {
    start: "Оформить услугу",
    from: "от",
    step: "Шаг",
    details: "Параметры",
    files: "Файлы и детали",
    review: "Проверка",
    next: "Продолжить",
    back: "Назад",
    calculate: "Рассчитать",
    estimate: "Предварительная стоимость",
    required: "Заполните обязательные поля",
    fileReady: "Файл выбран",
    chooseFile: "Выбрать файл",
    disclaimer:
      "Демонстрационный расчёт. Итоговая цена уточняется после проверки файлов.",
    confirm: "Подтвердить демо-заказ",
    success: "Демо-заказ создан",
    successText:
      "Мы сохранили параметры только в этом браузере. Реальная заявка не отправлялась.",
    done: "Вернуться к услугам",
    serviceNotCart:
      "Услуга оформляется отдельно и не добавляется в товарную корзину.",
  },
  uz: {
    start: "Xizmatni buyurtma qilish",
    from: "dan",
    step: "Qadam",
    details: "Parametrlar",
    files: "Fayl va tafsilotlar",
    review: "Tekshirish",
    next: "Davom etish",
    back: "Orqaga",
    calculate: "Hisoblash",
    estimate: "Taxminiy narx",
    required: "Majburiy maydonlarni to‘ldiring",
    fileReady: "Fayl tanlandi",
    chooseFile: "Fayl tanlash",
    disclaimer: "Demo hisob. Yakuniy narx fayllar tekshirilgach aniqlanadi.",
    confirm: "Demo-buyurtmani tasdiqlash",
    success: "Demo-buyurtma yaratildi",
    successText:
      "Parametrlar faqat shu brauzerda saqlandi. Haqiqiy ariza yuborilmadi.",
    done: "Xizmatlarga qaytish",
    serviceNotCart:
      "Xizmat alohida rasmiylashtiriladi va mahsulot savatiga qo‘shilmaydi.",
  },
  en: {
    start: "Configure service",
    from: "from",
    step: "Step",
    details: "Options",
    files: "Files & details",
    review: "Review",
    next: "Continue",
    back: "Back",
    calculate: "Calculate",
    estimate: "Estimated price",
    required: "Complete the required fields",
    fileReady: "File selected",
    chooseFile: "Choose file",
    disclaimer: "Demo estimate. Final pricing follows file review.",
    confirm: "Confirm demo order",
    success: "Demo order created",
    successText:
      "The options were saved only in this browser. No real request was sent.",
    done: "Back to services",
    serviceNotCart:
      "Services use a dedicated order flow and are not added to the product cart.",
  },
} as const;

export const textFor = (value: LocalizedText, locale: CustomerLocale) =>
  value[locale];
