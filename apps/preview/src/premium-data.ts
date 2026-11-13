import type { CustomerLocale } from "@agat/i18n";

export type PremiumCategory =
  | "id-photo"
  | "printing"
  | "outdoor"
  | "presentations"
  | "coursework"
  | "design"
  | "stationery"
  | "gifts"
  | "accessories"
  | "photo-gifts"
  | "study-office";

export interface LocalizedText {
  ru: string;
  uz: string;
  en: string;
}

export interface PremiumProduct {
  id: string;
  category: PremiumCategory;
  icon: string;
  name: LocalizedText;
  description: LocalizedText;
  priceMinor: number;
  oldPriceMinor?: number;
  rating: number;
  reviews: number;
  tone: string;
  badge?: LocalizedText;
}

export const localized = (value: LocalizedText, locale: CustomerLocale) =>
  value[locale];

export const categories: Array<{
  id: PremiumCategory;
  icon: string;
  label: LocalizedText;
}> = [
  {
    id: "id-photo",
    icon: "ID",
    label: {
      ru: "Фото на документы",
      uz: "Hujjat uchun foto",
      en: "ID photos",
    },
  },
  {
    id: "printing",
    icon: "PR",
    label: { ru: "Распечатка", uz: "Chop etish", en: "Printing" },
  },
  {
    id: "outdoor",
    icon: "AD",
    label: { ru: "Наружная реклама", uz: "Tashqi reklama", en: "Outdoor ads" },
  },
  {
    id: "presentations",
    icon: "SL",
    label: {
      ru: "Презентации и рефераты",
      uz: "Taqdimot va referatlar",
      en: "Presentations",
    },
  },
  {
    id: "coursework",
    icon: "CW",
    label: { ru: "Курсовые работы", uz: "Kurs ishlari", en: "Coursework" },
  },
  {
    id: "design",
    icon: "GD",
    label: {
      ru: "Графический дизайн",
      uz: "Grafik dizayn",
      en: "Graphic design",
    },
  },
  {
    id: "stationery",
    icon: "ST",
    label: { ru: "Канцтовары", uz: "Kanselyariya", en: "Stationery" },
  },
  {
    id: "gifts",
    icon: "GF",
    label: { ru: "Сувениры", uz: "Suvenirlar", en: "Gifts" },
  },
  {
    id: "accessories",
    icon: "AC",
    label: { ru: "Аксессуары", uz: "Aksessuarlar", en: "Accessories" },
  },
  {
    id: "photo-gifts",
    icon: "PG",
    label: { ru: "Фотоподарки", uz: "Foto sovg‘alar", en: "Photo gifts" },
  },
  {
    id: "study-office",
    icon: "SO",
    label: {
      ru: "Учёба и офис",
      uz: "Ta’lim va ofis",
      en: "Study & office",
    },
  },
];

const productTemplates: PremiumProduct[] = [
  {
    id: "daily-planner",
    category: "stationery",
    icon: "▤",
    name: { ru: "Ежедневник A5", uz: "A5 kundalik", en: "A5 daily planner" },
    description: {
      ru: "Недатированный, 120 листов",
      uz: "Sanasiz, 120 varaq",
      en: "Undated, 120 sheets",
    },
    priceMinor: 45_000,
    rating: 4.9,
    reviews: 328,
    tone: "berry",
    badge: { ru: "Хит", uz: "Mashhur", en: "Bestseller" },
  },
  {
    id: "pen-set",
    category: "stationery",
    icon: "✎",
    name: { ru: "Набор ручек", uz: "Ruchkalar to‘plami", en: "Pen set" },
    description: {
      ru: "6 цветов, мягкое письмо",
      uz: "6 rang, yumshoq yozuv",
      en: "6 colors, smooth writing",
    },
    priceMinor: 28_000,
    rating: 4.8,
    reviews: 412,
    tone: "sky",
  },
  {
    id: "desk-organizer",
    category: "accessories",
    icon: "▥",
    name: {
      ru: "Настольный органайзер",
      uz: "Stol organayzeri",
      en: "Desk organizer",
    },
    description: {
      ru: "Для канцелярии и заметок",
      uz: "Kanselyariya va qaydlar uchun",
      en: "For stationery and notes",
    },
    priceMinor: 79_000,
    rating: 4.9,
    reviews: 167,
    tone: "peach",
  },
  {
    id: "led-lamp",
    category: "accessories",
    icon: "⌁",
    name: {
      ru: "Настольная LED-лампа",
      uz: "Stol LED chirog‘i",
      en: "LED desk lamp",
    },
    description: {
      ru: "Три режима света",
      uz: "Uch yorug‘lik rejimi",
      en: "Three light modes",
    },
    priceMinor: 129_000,
    oldPriceMinor: 149_000,
    rating: 4.8,
    reviews: 95,
    tone: "cream",
  },
  {
    id: "power-bank",
    category: "accessories",
    icon: "▰",
    name: {
      ru: "Power Bank 10 000 mAh",
      uz: "Power Bank 10 000 mAh",
      en: "10,000 mAh power bank",
    },
    description: {
      ru: "Компактная быстрая зарядка",
      uz: "Ixcham tez quvvatlash",
      en: "Compact fast charging",
    },
    priceMinor: 149_000,
    rating: 4.8,
    reviews: 263,
    tone: "lilac",
  },
  {
    id: "photo-frame",
    category: "photo-gifts",
    icon: "▣",
    name: { ru: "Фоторамка A4", uz: "A4 fotoramka", en: "A4 photo frame" },
    description: {
      ru: "Дерево, защитное стекло",
      uz: "Yog‘och, himoya oynasi",
      en: "Wood with protective glass",
    },
    priceMinor: 69_000,
    rating: 4.9,
    reviews: 146,
    tone: "sand",
  },
  {
    id: "photo-mug",
    category: "photo-gifts",
    icon: "◉",
    name: { ru: "Кружка с фотографией", uz: "Suratli krujka", en: "Photo mug" },
    description: {
      ru: "Полноцветная сублимация",
      uz: "To‘liq rangli sublimatsiya",
      en: "Full-color sublimation",
    },
    priceMinor: 49_000,
    rating: 4.9,
    reviews: 567,
    tone: "rose",
    badge: { ru: "Подарок", uz: "Sovg‘a", en: "Gift pick" },
  },
  {
    id: "print-tshirt",
    category: "photo-gifts",
    icon: "T",
    name: {
      ru: "Футболка с принтом",
      uz: "Printli futbolka",
      en: "Printed T-shirt",
    },
    description: {
      ru: "Хлопок, печать A4",
      uz: "Paxta, A4 bosma",
      en: "Cotton, A4 print",
    },
    priceMinor: 69_000,
    rating: 4.8,
    reviews: 309,
    tone: "cream",
  },
  {
    id: "photo-pillow",
    category: "photo-gifts",
    icon: "◇",
    name: { ru: "Подушка с фото", uz: "Suratli yostiq", en: "Photo cushion" },
    description: {
      ru: "40 × 40 см, съёмный чехол",
      uz: "40 × 40 sm, yechiladigan g‘ilof",
      en: "40 × 40 cm, removable cover",
    },
    priceMinor: 59_000,
    rating: 4.9,
    reviews: 288,
    tone: "peach",
  },
  {
    id: "photo-keyring",
    category: "gifts",
    icon: "◌",
    name: { ru: "Брелок с фото", uz: "Suratli brelok", en: "Photo keyring" },
    description: {
      ru: "Двусторонняя печать",
      uz: "Ikki tomonlama bosma",
      en: "Double-sided print",
    },
    priceMinor: 19_000,
    rating: 4.8,
    reviews: 214,
    tone: "sky",
  },
  {
    id: "photo-album",
    category: "gifts",
    icon: "▱",
    name: {
      ru: "Фотоальбом на 200 фото",
      uz: "200 suratli fotoalbom",
      en: "200-photo album",
    },
    description: {
      ru: "Твёрдая обложка",
      uz: "Qattiq muqova",
      en: "Hard cover",
    },
    priceMinor: 99_000,
    rating: 4.8,
    reviews: 151,
    tone: "amber",
  },
  {
    id: "id-photo-set",
    category: "id-photo",
    icon: "ID",
    name: {
      ru: "Фото 3×4 — комплект",
      uz: "3×4 foto to‘plami",
      en: "3×4 ID photo set",
    },
    description: {
      ru: "6 фотографий на листе",
      uz: "Bir varaqda 6 ta surat",
      en: "6 photos per sheet",
    },
    priceMinor: 25_000,
    rating: 4.9,
    reviews: 904,
    tone: "lilac",
    badge: { ru: "За 15 минут", uz: "15 daqiqada", en: "Ready in 15 min" },
  },
  {
    id: "document-print",
    category: "printing",
    icon: "A4",
    name: {
      ru: "Цветная печать A4",
      uz: "A4 rangli chop etish",
      en: "A4 color printing",
    },
    description: {
      ru: "Цена за страницу, бумага 80 г/м²",
      uz: "Bir sahifa narxi, 80 g/m² qog‘oz",
      en: "Per page, 80 gsm paper",
    },
    priceMinor: 2_500,
    rating: 4.9,
    reviews: 1_204,
    tone: "sky",
  },
  {
    id: "large-format",
    category: "outdoor",
    icon: "XL",
    name: {
      ru: "Печать баннера",
      uz: "Banner chop etish",
      en: "Banner printing",
    },
    description: {
      ru: "Широкоформатная печать, за м²",
      uz: "Keng formatli bosma, m² uchun",
      en: "Large format, per m²",
    },
    priceMinor: 85_000,
    rating: 4.8,
    reviews: 186,
    tone: "berry",
  },
  {
    id: "presentation-design",
    category: "presentations",
    icon: "PPT",
    name: {
      ru: "Дизайн презентации",
      uz: "Taqdimot dizayni",
      en: "Presentation design",
    },
    description: {
      ru: "До 10 слайдов",
      uz: "10 slaydgacha",
      en: "Up to 10 slides",
    },
    priceMinor: 120_000,
    rating: 4.9,
    reviews: 118,
    tone: "rose",
  },
  {
    id: "coursework-bind",
    category: "coursework",
    icon: "CW",
    name: {
      ru: "Печать и переплёт курсовой",
      uz: "Kurs ishini chop etish va muqovalash",
      en: "Coursework print & bind",
    },
    description: {
      ru: "До 60 страниц, мягкий переплёт",
      uz: "60 sahifagacha, yumshoq muqova",
      en: "Up to 60 pages, soft binding",
    },
    priceMinor: 74_000,
    rating: 4.8,
    reviews: 276,
    tone: "lilac",
  },
  {
    id: "logo-design",
    category: "design",
    icon: "A",
    name: { ru: "Логотип Start", uz: "Start logotipi", en: "Logo Start" },
    description: {
      ru: "2 концепции и исходник",
      uz: "2 konsepsiya va manba fayli",
      en: "2 concepts and source file",
    },
    priceMinor: 349_000,
    rating: 4.9,
    reviews: 88,
    tone: "berry",
  },
  {
    id: "school-backpack",
    category: "study-office",
    icon: "▰",
    name: {
      ru: "Школьный рюкзак",
      uz: "Maktab ryukzagi",
      en: "School backpack",
    },
    description: {
      ru: "Эргономичная спинка",
      uz: "Ergonomik orqa qism",
      en: "Ergonomic back",
    },
    priceMinor: 299_000,
    rating: 4.9,
    reviews: 520,
    tone: "rose",
  },
];

const editions: LocalizedText[] = [
  { ru: "Классика", uz: "Klassika", en: "Classic" },
  {
    ru: "Лимитированная серия",
    uz: "Cheklangan turkum",
    en: "Limited edition",
  },
  { ru: "Новая коллекция", uz: "Yangi to‘plam", en: "New collection" },
  { ru: "Премиум", uz: "Premium", en: "Premium" },
  { ru: "Мини", uz: "Mini", en: "Mini" },
  { ru: "Плюс", uz: "Plus", en: "Plus" },
];

export const createProductFeed = (count: number): PremiumProduct[] =>
  Array.from({ length: count }, (_, index) => {
    const template = productTemplates[index % productTemplates.length]!;
    const edition =
      editions[Math.floor(index / productTemplates.length) % editions.length]!;
    const generation = Math.floor(
      index / (productTemplates.length * editions.length),
    );
    const suffix = generation > 0 ? ` ${generation + 1}` : "";
    const isBase = index < productTemplates.length;
    return {
      ...template,
      id: `${template.id}-${index + 1}`,
      name: isBase
        ? template.name
        : {
            ru: `${template.name.ru} · ${edition.ru}${suffix}`,
            uz: `${template.name.uz} · ${edition.uz}${suffix}`,
            en: `${template.name.en} · ${edition.en}${suffix}`,
          },
      priceMinor: template.priceMinor + (index % 5) * 3_000,
      reviews: template.reviews + index * 3,
    };
  });

export const initialProducts = createProductFeed(24);
