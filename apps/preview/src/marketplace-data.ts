import type { CustomerLocale } from "@agat/i18n";
import type { LocalizedText } from "./premium-data";

export type MarketplaceCategory =
  | "stationery"
  | "office"
  | "accessories"
  | "gifts"
  | "photo"
  | "study";

export type MarketplaceSeller = {
  id: string;
  slug: string;
  name: string;
  city: LocalizedText;
  description: LocalizedText;
  rating: number;
  reviews: number;
  delivery: LocalizedText;
  verified: boolean;
};

export type MarketplaceOffer = {
  id: string;
  sellerId: string;
  priceMinor: number;
  oldPriceMinor?: number;
  stock: number;
  deliveryDays: number;
};

export type MarketplaceProduct = {
  id: string;
  slug: string;
  category: MarketplaceCategory;
  subcategory: string;
  name: LocalizedText;
  description: LocalizedText;
  rating: number;
  reviews: number;
  variants: LocalizedText[];
  imageSheet: "office" | "gifts";
  imageIndex: number;
  imageDataUrl?: string;
  badge?: LocalizedText;
  offers: MarketplaceOffer[];
};

const t = (ru: string, uz: string, en: string): LocalizedText => ({
  ru,
  uz,
  en,
});

export const marketplaceText = (value: LocalizedText, locale: CustomerLocale) =>
  value[locale];

export const marketplaceCategories: Array<{
  id: MarketplaceCategory;
  label: LocalizedText;
  icon: string;
}> = [
  {
    id: "stationery",
    label: t("Канцтовары", "Kanselyariya", "Stationery"),
    icon: "notebook",
  },
  { id: "office", label: t("Офис", "Ofis", "Office"), icon: "briefcase" },
  {
    id: "accessories",
    label: t("Аксессуары", "Aksessuarlar", "Accessories"),
    icon: "headphones",
  },
  { id: "gifts", label: t("Подарки", "Sovg‘alar", "Gifts"), icon: "gift" },
  {
    id: "photo",
    label: t("Фототовары", "Foto mahsulotlar", "Photo products"),
    icon: "photo",
  },
  { id: "study", label: t("Учёба", "O‘qish", "Study"), icon: "book" },
];

export const marketplaceSellers: MarketplaceSeller[] = [
  {
    id: "seller-agat",
    slug: "agat-print-tashkent",
    name: "AGAT PRINT Tashkent",
    city: t("Ташкент", "Toshkent", "Tashkent"),
    description: t(
      "Печать, фототовары и товары для офиса с проверкой качества.",
      "Sifat nazorati bilan chop etish, foto va ofis mahsulotlari.",
      "Print, photo and office products with quality control.",
    ),
    rating: 4.9,
    reviews: 1248,
    delivery: t("Сегодня или завтра", "Bugun yoki ertaga", "Today or tomorrow"),
    verified: true,
  },
  {
    id: "seller-paper",
    slug: "paper-house",
    name: "Paper House",
    city: t("Ташкент", "Toshkent", "Tashkent"),
    description: t(
      "Канцтовары и материалы для учёбы и творчества.",
      "O‘qish va ijod uchun kanselyariya mahsulotlari.",
      "Stationery and supplies for study and creativity.",
    ),
    rating: 4.8,
    reviews: 684,
    delivery: t("1–2 дня", "1–2 kun", "1–2 days"),
    verified: true,
  },
  {
    id: "seller-gift",
    slug: "sovga-lab",
    name: "Sovg‘a Lab",
    city: t("Самарканд", "Samarqand", "Samarkand"),
    description: t(
      "Персональные подарки и аксессуары небольшими тиражами.",
      "Kichik tirajdagi shaxsiy sovg‘alar va aksessuarlar.",
      "Personal gifts and accessories in small batches.",
    ),
    rating: 4.7,
    reviews: 392,
    delivery: t("2–3 дня", "2–3 kun", "2–3 days"),
    verified: true,
  },
];

type ProductSeed = [
  string,
  MarketplaceCategory,
  string,
  LocalizedText,
  LocalizedText,
  "office" | "gifts",
  number,
  number,
  string,
  string,
];

const seeds: ProductSeed[] = [
  [
    "premium-notebook",
    "stationery",
    "notebooks",
    t("Ежедневник Premium A5", "Premium A5 kundalik", "Premium A5 planner"),
    t(
      "Плотная бумага, закладка и мягкая обложка",
      "Qalin qog‘oz, xatcho‘p va yumshoq muqova",
      "Thick paper, bookmark and soft cover",
    ),
    "office",
    0,
    45_000,
    "seller-agat",
    "seller-paper",
  ],
  [
    "color-pens",
    "stationery",
    "writing",
    t("Набор цветных ручек", "Rangli ruchkalar to‘plami", "Color pen set"),
    t(
      "Восемь мягко пишущих цветов",
      "Sakkizta yumshoq yozuvchi rang",
      "Eight smooth-writing colors",
    ),
    "office",
    1,
    28_000,
    "seller-paper",
    "seller-agat",
  ],
  [
    "desk-organizer",
    "office",
    "organization",
    t("Настольный органайзер", "Stol organayzeri", "Desk organizer"),
    t(
      "Отделения для канцелярии и заметок",
      "Kanselyariya va eslatmalar uchun",
      "Compartments for stationery and notes",
    ),
    "office",
    2,
    79_000,
    "seller-agat",
    "seller-paper",
  ],
  [
    "desk-lamp",
    "office",
    "lighting",
    t("Настольная LED-лампа", "LED stol chirog‘i", "LED desk lamp"),
    t(
      "Три режима света и регулировка наклона",
      "Uchta yorug‘lik rejimi",
      "Three light modes and adjustable angle",
    ),
    "office",
    3,
    129_000,
    "seller-paper",
    "seller-agat",
  ],
  [
    "headphones",
    "accessories",
    "electronics",
    t("Беспроводные наушники", "Simsiz quloqchin", "Wireless headphones"),
    t(
      "Мягкие амбушюры и складная конструкция",
      "Yumshoq quloqchalar va yig‘ma",
      "Soft ear cushions and foldable design",
    ),
    "office",
    4,
    249_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "power-bank",
    "accessories",
    "electronics",
    t(
      "Power Bank 10 000 mAh",
      "Power Bank 10 000 mAh",
      "10,000 mAh power bank",
    ),
    t(
      "Компактная зарядка с двумя портами",
      "Ikki portli ixcham quvvatlagich",
      "Compact charger with two ports",
    ),
    "office",
    5,
    149_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "school-backpack",
    "study",
    "bags",
    t("Школьный рюкзак", "Maktab ryukzagi", "School backpack"),
    t(
      "Усиленная спинка и отделение для ноутбука",
      "Mustahkam orqa va noutbuk bo‘limi",
      "Padded back and laptop compartment",
    ),
    "office",
    6,
    299_000,
    "seller-paper",
    "seller-agat",
  ],
  [
    "document-folder",
    "office",
    "folders",
    t("Папка для документов", "Hujjatlar papkasi", "Document folder"),
    t(
      "Надёжная застёжка и формат A4",
      "Ishonchli yopilish va A4 format",
      "Secure closure and A4 format",
    ),
    "office",
    7,
    32_000,
    "seller-paper",
    "seller-agat",
  ],
  [
    "sketchbook",
    "study",
    "paper",
    t("Скетчбук на пружине", "Spiral sketcbuk", "Spiral sketchbook"),
    t(
      "Плотная бумага для маркеров и карандашей",
      "Marker va qalam uchun qalin qog‘oz",
      "Thick paper for markers and pencils",
    ),
    "office",
    8,
    38_000,
    "seller-paper",
    "seller-gift",
  ],
  [
    "calculator",
    "study",
    "electronics",
    t("Настольный калькулятор", "Stol kalkulyatori", "Desktop calculator"),
    t(
      "Крупные клавиши и контрастный экран",
      "Katta tugmalar va aniq ekran",
      "Large keys and high-contrast display",
    ),
    "office",
    9,
    62_000,
    "seller-paper",
    "seller-agat",
  ],
  [
    "printer-paper",
    "office",
    "paper",
    t("Бумага A4, 500 листов", "A4 qog‘oz, 500 varaq", "A4 paper, 500 sheets"),
    t(
      "Белая офисная бумага 80 г/м²",
      "Oq ofis qog‘ozi 80 g/m²",
      "White 80 gsm office paper",
    ),
    "office",
    10,
    67_000,
    "seller-agat",
    "seller-paper",
  ],
  [
    "photo-printer",
    "photo",
    "devices",
    t("Компактный фотопринтер", "Ixcham fotoprinter", "Compact photo printer"),
    t(
      "Демонстрационная модель для печати 10×15",
      "10×15 chop uchun demo model",
      "Demo model for 10×15 prints",
    ),
    "office",
    11,
    899_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "photo-mug",
    "photo",
    "personalized",
    t("Кружка с фотопечатью", "Foto bosmali krujka", "Photo print mug"),
    t(
      "Персональная печать на керамике",
      "Keramikada shaxsiy bosma",
      "Personalized ceramic print",
    ),
    "gifts",
    0,
    49_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "photo-frame",
    "photo",
    "decor",
    t("Фоторамка 20×30", "Fotoramka 20×30", "20×30 photo frame"),
    t(
      "Тонкая металлическая рамка со стеклом",
      "Shishali nozik metall ramka",
      "Slim metal frame with glass",
    ),
    "gifts",
    1,
    69_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "gift-box",
    "gifts",
    "sets",
    t("Подарочный набор", "Sovg‘a to‘plami", "Gift set"),
    t(
      "Коробка, лента и персональная открытка",
      "Quti, lenta va shaxsiy tabrik",
      "Box, ribbon and personalized card",
    ),
    "gifts",
    2,
    199_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "tote-bag",
    "gifts",
    "textile",
    t("Хлопковый шоппер", "Paxta shopper", "Cotton tote bag"),
    t(
      "Плотная ткань, подходит для печати",
      "Qalin mato, bosma uchun mos",
      "Heavy cotton, suitable for printing",
    ),
    "gifts",
    3,
    79_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "print-tshirt",
    "gifts",
    "textile",
    t("Футболка для печати", "Bosma uchun futbolka", "Printable T-shirt"),
    t(
      "Белый хлопок, размеры S–XL",
      "Oq paxta, S–XL o‘lcham",
      "White cotton, sizes S–XL",
    ),
    "gifts",
    4,
    129_000,
    "seller-agat",
    "seller-gift",
  ],
  [
    "keychain",
    "gifts",
    "personalized",
    t("Металлический брелок", "Metall brelok", "Metal keychain"),
    t(
      "Гравировка имени или короткой фразы",
      "Ism yoki qisqa yozuv o‘yish",
      "Name or short phrase engraving",
    ),
    "gifts",
    5,
    39_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "umbrella",
    "accessories",
    "travel",
    t("Компактный зонт", "Ixcham soyabon", "Compact umbrella"),
    t(
      "Автоматическое открытие и прочный купол",
      "Avtomatik ochilish va mustahkam",
      "Automatic opening and durable canopy",
    ),
    "gifts",
    6,
    119_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "phone-case",
    "accessories",
    "electronics",
    t(
      "Чехол с персональным дизайном",
      "Shaxsiy dizaynli g‘ilof",
      "Custom phone case",
    ),
    t(
      "Демонстрационная печать изображения",
      "Rasm bosmasi demo",
      "Demonstration image printing",
    ),
    "gifts",
    7,
    89_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "thermos",
    "accessories",
    "travel",
    t("Термос 500 мл", "Termos 500 ml", "500 ml thermos"),
    t(
      "Стальной корпус и герметичная крышка",
      "Po‘lat korpus va germetik qopqoq",
      "Steel body and leakproof lid",
    ),
    "gifts",
    8,
    159_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "wall-clock",
    "gifts",
    "decor",
    t("Настенные часы", "Devor soati", "Wall clock"),
    t(
      "Тихий механизм и минималистичный дизайн",
      "Jim mexanizm va minimal dizayn",
      "Silent mechanism and minimal design",
    ),
    "gifts",
    9,
    139_000,
    "seller-gift",
    "seller-agat",
  ],
  [
    "table-plant",
    "office",
    "decor",
    t("Растение для рабочего стола", "Stol uchun o‘simlik", "Desk plant"),
    t(
      "Неприхотливое растение в керамическом кашпо",
      "Keramik idishdagi oson o‘simlik",
      "Easy-care plant in a ceramic pot",
    ),
    "gifts",
    10,
    95_000,
    "seller-paper",
    "seller-gift",
  ],
  [
    "desk-calendar",
    "office",
    "calendars",
    t("Настольный календарь", "Stol taqvimi", "Desk calendar"),
    t(
      "Премиальная подставка и сменные блоки",
      "Premium taglik va almashuvchi bloklar",
      "Premium stand and replaceable pages",
    ),
    "gifts",
    11,
    74_000,
    "seller-agat",
    "seller-gift",
  ],
];

export const marketplaceProducts: MarketplaceProduct[] = seeds.map(
  (
    [
      slug,
      category,
      subcategory,
      name,
      description,
      imageSheet,
      imageIndex,
      basePrice,
      primary,
      secondary,
    ],
    index,
  ) => {
    const badge =
      index % 5 === 0
        ? t("Хит", "Xit", "Bestseller")
        : index % 7 === 0
          ? t("Новинка", "Yangi", "New")
          : undefined;

    return {
      id: `product-${String(index + 1).padStart(3, "0")}`,
      slug,
      category,
      subcategory,
      name,
      description,
      rating: Number((4.6 + (index % 4) * 0.1).toFixed(1)),
      reviews: 48 + index * 37,
      variants: [
        t("Стандарт", "Standart", "Standard"),
        t("Подарочная упаковка", "Sovg‘a o‘rami", "Gift wrap"),
      ],
      imageSheet,
      imageIndex,
      ...(badge ? { badge } : {}),
      offers: [
        {
          id: `offer-${String(index + 1).padStart(3, "0")}-a`,
          sellerId: primary,
          priceMinor: basePrice,
          ...(index % 3 === 0
            ? { oldPriceMinor: Math.round(basePrice * 1.2) }
            : {}),
          stock: 4 + ((index * 7) % 31),
          deliveryDays: 1 + (index % 2),
        },
        {
          id: `offer-${String(index + 1).padStart(3, "0")}-b`,
          sellerId: secondary,
          priceMinor: basePrice + 3_000 + (index % 4) * 2_000,
          stock: index % 6 === 0 ? 0 : 3 + ((index * 5) % 18),
          deliveryDays: 2 + (index % 2),
        },
      ],
    };
  },
);

export const sellerById = (id: string) =>
  marketplaceSellers.find((seller) => seller.id === id)!;

export const productBySlug = (slug: string) =>
  marketplaceProducts.find((product) => product.slug === slug);

export const lowestOffer = (product: MarketplaceProduct): MarketplaceOffer =>
  product.offers
    .filter((offer) => offer.stock > 0)
    .sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? product.offers[0]!;
