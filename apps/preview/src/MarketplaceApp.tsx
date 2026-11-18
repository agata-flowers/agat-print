import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { localeFrom, type CustomerLocale } from "@agat/i18n";
import { getMarketplaceCopy } from "./marketplace-copy";
import { marketplaceBrand } from "./marketplace-brand";
import {
  lowestOffer,
  marketplaceCategories,
  marketplaceProducts,
  marketplaceSellers,
  marketplaceText,
  productBySlug,
  sellerById,
  type MarketplaceCategory,
  type MarketplaceProduct,
} from "./marketplace-data";
import { localized } from "./premium-data";
import { premiumServices, type PremiumService } from "./premium-services";
import {
  eligibleAssignmentCandidates,
  rankAssignmentCandidates,
  type RankedCandidate,
} from "./marketplace-assignment";
import "./marketplace.css";

type Cart = Record<string, number>;
type DemoOrder = {
  id: string;
  createdAt: string;
  total: number;
  fulfillment: "pickup" | "courier";
  status: "created" | "preparing" | "ready";
  items: Array<{ offerId: string; quantity: number }>;
};
type SellerOverride = Record<string, { price: number; stock: number }>;

const PREFIX = "/marketplace";
const STORAGE = {
  cart: "agat-marketplace-cart",
  favorites: "agat-marketplace-favorites",
  views: "agat-marketplace-views",
  orders: "agat-marketplace-orders",
  seller: "agat-marketplace-seller-overrides",
  profile: "agat-marketplace-profile",
  scroll: "agat-marketplace-scroll",
  customProducts: "agat-marketplace-custom-products",
};

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const money = (amount: number, locale: CustomerLocale) =>
  new Intl.NumberFormat(
    locale === "uz" ? "uz-UZ" : locale === "ru" ? "ru-RU" : "en-US",
  ).format(amount);

const ui = (locale: CustomerLocale, ru: string, uz: string, en: string) =>
  ({ ru, uz, en })[locale];

const asSellerListings = (products: MarketplaceProduct[]) =>
  products.flatMap((product) =>
    product.offers.map((offer) => {
      const seller = sellerById(offer.sellerId);
      return {
        ...product,
        id: `${product.id}--${offer.id}`,
        slug: `${product.slug}--${seller.slug}`,
        offers: [offer],
      } satisfies MarketplaceProduct;
    }),
  );

const effectiveOfferPrice = (
  product: MarketplaceProduct,
  offerId: string,
  overrides: SellerOverride,
) => {
  const offer = product.offers.find((item) => item.id === offerId);
  if (!offer) return 0;
  return offer.sellerId === "seller-agat"
    ? (overrides[product.id]?.price ?? offer.priceMinor)
    : offer.priceMinor;
};

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle {...common} cx="10.5" cy="10.5" r="6.5" />
        <path {...common} d="m16 16 5 5" />
      </>
    ),
    grid: (
      <>
        <rect {...common} x="3" y="3" width="7" height="7" rx="1" />
        <rect {...common} x="14" y="3" width="7" height="7" rx="1" />
        <rect {...common} x="3" y="14" width="7" height="7" rx="1" />
        <rect {...common} x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    user: (
      <>
        <circle {...common} cx="12" cy="8" r="4" />
        <path {...common} d="M4 21c1-5 4-7 8-7s7 2 8 7" />
      </>
    ),
    heart: (
      <path
        {...common}
        d="M20.8 4.6c-2-2-5.2-2-7.2 0L12 6.2l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 20l8.8-8.2a5.1 5.1 0 0 0 0-7.2Z"
      />
    ),
    cart: (
      <>
        <path {...common} d="M3 4h2l2 11h11l2-8H7" />
        <circle cx="9" cy="20" r="1.4" fill="currentColor" />
        <circle cx="18" cy="20" r="1.4" fill="currentColor" />
      </>
    ),
    home: <path {...common} d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z" />,
    store: (
      <>
        <path {...common} d="M4 9h16l-2-6H6Z" />
        <path {...common} d="M5 9v12h14V9M9 21v-7h6v7" />
      </>
    ),
    location: (
      <>
        <path {...common} d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle {...common} cx="12" cy="10" r="2.5" />
      </>
    ),
    bell: (
      <>
        <path {...common} d="M6 17h12l-2-3V9a4 4 0 0 0-8 0v5Z" />
        <path {...common} d="M10 20h4" />
      </>
    ),
    settings: (
      <>
        <circle {...common} cx="12" cy="12" r="3" />
        <path
          {...common}
          d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2"
        />
      </>
    ),
    package: (
      <>
        <path {...common} d="m3 7 9-4 9 4-9 4Z" />
        <path {...common} d="M3 7v10l9 4 9-4V7M12 11v10" />
      </>
    ),
    star: (
      <path
        {...common}
        d="m12 2 3 6 7 .9-5 4.8 1.3 7-6.3-3.3-6.3 3.3 1.3-7-5-4.8L9 8Z"
      />
    ),
    filter: <path {...common} d="M3 5h18l-7 8v6l-4 2v-8Z" />,
    arrow: <path {...common} d="m9 5 7 7-7 7" />,
    plus: <path {...common} d="M12 4v16M4 12h16" />,
    check: <path {...common} d="m4 13 5 5L20 6" />,
    upload: (
      <>
        <path {...common} d="M12 16V3m0 0L7 8m5-5 5 5" />
        <path {...common} d="M4 15v6h16v-6" />
      </>
    ),
    notebook: (
      <>
        <rect {...common} x="6" y="3" width="14" height="18" rx="2" />
        <path {...common} d="M6 7H3m3 5H3m3 5H3" />
      </>
    ),
    briefcase: (
      <>
        <rect {...common} x="3" y="7" width="18" height="13" rx="2" />
        <path {...common} d="M8 7V4h8v3M3 12h18" />
      </>
    ),
    headphones: (
      <path
        {...common}
        d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h4v7H5a1 1 0 0 1-1-1Zm16 0h-4v7h3a1 1 0 0 0 1-1Z"
      />
    ),
    gift: (
      <>
        <rect {...common} x="3" y="10" width="18" height="11" />
        <path
          {...common}
          d="M12 10v11M2 6h20v4H2Zm10 0c-1-4-6-4-6-1 0 2 3 2 6 1Zm0 0c1-4 6-4 6-1 0 2-3 2-6 1Z"
        />
      </>
    ),
    photo: (
      <>
        <rect {...common} x="3" y="4" width="18" height="16" rx="2" />
        <circle {...common} cx="9" cy="10" r="2" />
        <path {...common} d="m5 18 5-5 3 3 2-2 4 4" />
      </>
    ),
    book: (
      <path
        {...common}
        d="M3 5c4-1 7 0 9 2v14c-2-2-5-3-9-2Zm18 0c-4-1-7 0-9 2v14c2-2 5-3 9-2Z"
      />
    ),
    mobile: (
      <>
        <rect {...common} x="7" y="2" width="10" height="20" rx="2" />
        <path {...common} d="M10 5h4M11 18h2" />
      </>
    ),
    printer: (
      <>
        <path {...common} d="M7 8V3h10v5M7 17H4V9h16v8h-3" />
        <path {...common} d="M7 14h10v7H7Z" />
      </>
    ),
    up: <path {...common} d="m5 15 7-7 7 7" />,
  };
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      {paths[name] ?? paths.star}
    </svg>
  );
}

const routeFromLocation = () => {
  const path = window.location.pathname.startsWith(PREFIX)
    ? window.location.pathname.slice(PREFIX.length) || "/"
    : "/";
  return `${path}${window.location.search}`;
};

function MarketplaceBreadcrumbs({
  path,
  locale,
  navigate,
}: {
  path: string;
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  if (path === "/") return null;
  const first = path.split("/").filter(Boolean)[0] ?? "";
  const labels: Record<string, string> = {
    catalog: ui(locale, "Каталог", "Katalog", "Catalog"),
    category: ui(locale, "Категория", "Toifa", "Category"),
    product: ui(locale, "Товар", "Mahsulot", "Product"),
    store: ui(locale, "Магазин", "Do‘kon", "Store"),
    service: ui(locale, "Услуга", "Xizmat", "Service"),
    cart: ui(locale, "Корзина", "Savat", "Cart"),
    checkout: ui(locale, "Оформление", "Rasmiylashtirish", "Checkout"),
    account: ui(locale, "Личный кабинет", "Kabinet", "Account"),
    seller: ui(
      locale,
      "Кабинет продавца",
      "Sotuvchi kabineti",
      "Seller dashboard",
    ),
  };
  return (
    <nav
      aria-label={ui(locale, "Хлебные крошки", "Navigatsiya", "Breadcrumb")}
      className="market-breadcrumbs"
    >
      <button onClick={() => navigate("/")} type="button">
        {ui(locale, "Главная", "Bosh sahifa", "Home")}
      </button>
      <span aria-hidden="true">/</span>
      <strong>{labels[first] ?? labels.catalog}</strong>
    </nav>
  );
}

function ProductImage({
  product,
  className = "",
}: {
  product: MarketplaceProduct;
  className?: string;
}) {
  const column = product.imageIndex % 4;
  const row = Math.floor(product.imageIndex / 4);
  if (product.imageDataUrl)
    return (
      <div className={`market-product-image custom ${className}`}>
        <img
          alt={product.name.ru}
          decoding="async"
          loading="lazy"
          src={product.imageDataUrl}
        />
      </div>
    );
  return (
    <div
      aria-label={product.name.ru}
      className={`market-product-image sheet-${product.imageSheet} ${className}`}
      role="img"
      style={
        {
          "--mx": `${column * (100 / 3)}%`,
          "--my": `${row * 50}%`,
        } as CSSProperties
      }
    />
  );
}

type ProductCardProps = {
  product: MarketplaceProduct;
  locale: CustomerLocale;
  favorite: boolean;
  onFavorite: () => void;
  onOpen: () => void;
  onAdd: () => void;
  override: SellerOverride[string] | undefined;
};

function ProductCard({
  product,
  locale,
  favorite,
  onFavorite,
  onOpen,
  onAdd,
  override,
}: ProductCardProps) {
  const copy = getMarketplaceCopy(locale);
  const base = lowestOffer(product);
  const offer =
    override && base.sellerId === "seller-agat"
      ? { ...base, priceMinor: override.price, stock: override.stock }
      : base;
  return (
    <article className="market-product-card" data-product-id={product.id}>
      <button
        aria-label={`${copy.openProduct}: ${marketplaceText(product.name, locale)}`}
        className="market-product-open"
        onClick={onOpen}
        type="button"
      >
        <ProductImage product={product} />
        {product.badge ? (
          <span className="market-badge">
            {marketplaceText(product.badge, locale)}
          </span>
        ) : null}
      </button>
      <button
        aria-label={copy.favorites}
        aria-pressed={favorite}
        className="market-heart"
        onClick={onFavorite}
        type="button"
      >
        <Icon name="heart" size={20} />
      </button>
      <div className="market-product-copy">
        <button className="market-product-name" onClick={onOpen} type="button">
          {marketplaceText(product.name, locale)}
        </button>
        <div className="market-rating">
          <span>★ {product.rating}</span>
          <small>({product.reviews})</small>
        </div>
        <div className="market-price-line">
          <div>
            {offer.oldPriceMinor ? (
              <del>{money(offer.oldPriceMinor, locale)}</del>
            ) : null}
            <strong>
              {money(offer.priceMinor, locale)} {copy.sum}
            </strong>
          </div>
          <button
            aria-label={`${copy.add}: ${marketplaceText(product.name, locale)}`}
            disabled={offer.stock < 1}
            onClick={onAdd}
            type="button"
          >
            <Icon name="cart" size={19} />
          </button>
        </div>
      </div>
    </article>
  );
}

type CommonPageProps = {
  locale: CustomerLocale;
  products: MarketplaceProduct[];
  favorites: string[];
  overrides: SellerOverride;
  openProduct: (product: MarketplaceProduct) => void;
  toggleFavorite: (id: string) => void;
  addProduct: (product: MarketplaceProduct, offerId?: string) => void;
  navigate: (path: string) => void;
};

function ProductGrid({
  items,
  ...props
}: CommonPageProps & { items: MarketplaceProduct[] }) {
  return (
    <div className="market-product-grid">
      {items.map((product) => (
        <ProductCard
          favorite={props.favorites.includes(product.id)}
          key={product.id}
          locale={props.locale}
          onAdd={() => props.addProduct(product)}
          onFavorite={() => props.toggleFavorite(product.id)}
          onOpen={() => props.openProduct(product)}
          override={props.overrides[product.id]}
          product={product}
        />
      ))}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="market-section">
      <div className="market-section-title">
        <h2>{title}</h2>
        {action ? (
          <button onClick={action} type="button">
            →
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ServiceStrip({
  locale,
  navigate,
}: {
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const copy = getMarketplaceCopy(locale);
  return (
    <Section
      action={() => navigate("/catalog?tab=services")}
      title={copy.popularServices}
    >
      <div className="market-service-grid">
        {premiumServices.map((service) => (
          <button
            className={`market-service-card service-${service.id}`}
            key={service.id}
            onClick={() => navigate(`/service/${service.id}`)}
            type="button"
          >
            <span>{localized(service.title, locale)}</span>
            <small>{localized(service.turnaround, locale)}</small>
            <b>→</b>
          </button>
        ))}
      </div>
    </Section>
  );
}

function HomeServiceCategories({
  locale,
  navigate,
}: {
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const cards = [
    ...premiumServices.map((service) => ({
      id: service.id,
      label: localized(service.title, locale),
      path: `/service/${service.id}`,
    })),
    {
      id: "catalog",
      label: ui(
        locale,
        "Каталог товаров",
        "Mahsulotlar katalogi",
        "Product catalog",
      ),
      path: "/catalog",
    },
  ];
  return (
    <section
      className="market-main-services"
      aria-label={ui(
        locale,
        "Основные услуги",
        "Asosiy xizmatlar",
        "Main services",
      )}
    >
      {cards.map((card) => (
        <button
          className={`market-main-service-card service-${card.id}`}
          key={card.id}
          onClick={() => navigate(card.path)}
          type="button"
        >
          <span aria-hidden="true" />
          <strong>{card.label}</strong>
        </button>
      ))}
    </section>
  );
}

function DemoQrMark() {
  const cells = [
    [1, 1],
    [2, 1],
    [3, 1],
    [7, 1],
    [8, 1],
    [9, 1],
    [1, 2],
    [3, 2],
    [5, 2],
    [7, 2],
    [9, 2],
    [1, 3],
    [2, 3],
    [3, 3],
    [5, 3],
    [7, 3],
    [8, 3],
    [9, 3],
    [4, 4],
    [6, 4],
    [2, 5],
    [3, 5],
    [5, 5],
    [7, 5],
    [8, 5],
    [1, 6],
    [4, 6],
    [6, 6],
    [9, 6],
    [1, 7],
    [2, 7],
    [3, 7],
    [5, 7],
    [7, 7],
    [8, 7],
    [9, 7],
    [1, 8],
    [3, 8],
    [4, 8],
    [6, 8],
    [7, 8],
    [9, 8],
    [1, 9],
    [2, 9],
    [3, 9],
    [5, 9],
    [7, 9],
    [8, 9],
    [9, 9],
  ];
  return (
    <svg aria-hidden="true" className="market-demo-qr" viewBox="0 0 11 11">
      <rect width="11" height="11" rx="1" fill="#fff" />
      {cells.map(([x, y]) => (
        <rect
          fill="currentColor"
          height="1"
          key={`${x}-${y}`}
          width="1"
          x={x}
          y={y}
        />
      ))}
    </svg>
  );
}

function HomeSidebar({
  locale,
  navigate,
}: {
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const copy = getMarketplaceCopy(locale);
  const items = [
    ["home", ui(locale, "Главная", "Bosh sahifa", "Home"), "/"],
    [
      "printer",
      ui(locale, "Услуги печати", "Chop etish xizmatlari", "Print services"),
      "/catalog?tab=services",
    ],
    [
      "book",
      ui(
        locale,
        "Дизайн и документы",
        "Dizayn va hujjatlar",
        "Design & documents",
      ),
      "/service/design",
    ],
    [
      "photo",
      ui(
        locale,
        "Реклама и вывески",
        "Reklama va peshlavhalar",
        "Advertising & signs",
      ),
      "/service/outdoor",
    ],
    [
      "grid",
      ui(locale, "Каталог товаров", "Mahsulotlar katalogi", "Product catalog"),
      "/catalog",
    ],
    [
      "gift",
      ui(
        locale,
        "Акции и скидки",
        "Aksiyalar va chegirmalar",
        "Deals & discounts",
      ),
      "/catalog?sort=discount",
    ],
    [
      "store",
      ui(locale, "Наши точки", "Bizning punktlar", "Our locations"),
      "/store/agat-print-tashkent",
    ],
    ["headphones", ui(locale, "Помощь", "Yordam", "Help"), "/account/support"],
  ] as const;
  return (
    <aside
      className="market-home-sidebar"
      aria-label={ui(locale, "Разделы", "Bo‘limlar", "Sections")}
    >
      <nav>
        {items.map(([icon, label, path], index) => (
          <button
            className={index === 0 ? "active" : ""}
            key={path}
            onClick={() => navigate(path)}
            type="button"
          >
            <Icon name={icon} size={22} />
            <span>{label}</span>
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </nav>
      <div className="market-app-promo">
        <div>
          <Icon name="mobile" size={28} />
          <strong>
            {ui(
              locale,
              "Скачайте мобильное приложение",
              "Mobil ilovani yuklab oling",
              "Download our mobile app",
            )}
          </strong>
          <p>{copy.demo}</p>
        </div>
        <DemoQrMark />
        <div className="market-app-badges">
          <span>App Store</span>
          <span>Google Play</span>
        </div>
      </div>
    </aside>
  );
}

function HomePromotions({
  locale,
  navigate,
}: {
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const cards = [
    [
      ui(locale, "Фото на документы", "Hujjat uchun foto", "ID photos"),
      ui(locale, "за 10 минут", "10 daqiqada", "in 10 minutes"),
      ui(locale, "от 25 000 сум", "25 000 so‘mdan", "from UZS 25,000"),
      "/service/idPhoto",
    ],
    [
      ui(locale, "Скидка 20%", "20% chegirma", "20% off"),
      ui(
        locale,
        "на печать от 50 листов",
        "50 varaqdan boshlab",
        "when printing 50+ sheets",
      ),
      "",
      "/service/printing",
    ],
    [
      ui(
        locale,
        "Печать на футболках",
        "Futbolkalarga bosma",
        "T-shirt printing",
      ),
      ui(locale, "и кепках", "va kepkalarga", "and caps"),
      ui(locale, "от 59 000 сум", "59 000 so‘mdan", "from UZS 59,000"),
      "/service/design",
    ],
  ] as const;
  return (
    <section
      className="market-home-promotions"
      aria-label={ui(locale, "Акции", "Aksiyalar", "Promotions")}
    >
      <div className="market-section-title market-home-subheading">
        <h2>
          🔥{" "}
          {ui(
            locale,
            "Акции и предложения",
            "Aksiyalar va takliflar",
            "Deals and offers",
          )}
        </h2>
        <button
          onClick={() => navigate("/catalog?sort=discount")}
          type="button"
        >
          {ui(locale, "Все акции", "Barcha aksiyalar", "All deals")} →
        </button>
      </div>
      <div className="market-home-promotion-row">
        {cards.map(([title, subtitle, price, path], index) => (
          <button
            className={`promo-${index + 1}`}
            key={title}
            onClick={() => navigate(path)}
            type="button"
          >
            <span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
              {price ? <b>{price}</b> : null}
            </span>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function QuickServices({
  locale,
  navigate,
}: {
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const services = [
    ["Ксерокопия", "Nusxa olish", "Photocopy", "printing"],
    ["Сканирование", "Skanerlash", "Scanning", "printing"],
    ["Ламинация", "Laminatsiya", "Lamination", "printing"],
    ["Переплёт", "Muqovalash", "Binding", "coursework"],
    ["Визитки", "Vizitkalar", "Business cards", "design"],
    ["Флаеры", "Flayerlar", "Flyers", "design"],
    ["Баннеры", "Bannerlar", "Banners", "outdoor"],
    ["Оракал", "Orakal", "Vinyl", "outdoor"],
  ] as const;
  return (
    <section className="market-quick-services">
      <div className="market-section-title">
        <h2>
          {ui(
            locale,
            "Популярные услуги",
            "Mashhur xizmatlar",
            "Popular services",
          )}
        </h2>
      </div>
      <div>
        {services.map(([ru, uz, en, id], index) => (
          <button
            key={ru}
            onClick={() => navigate(`/service/${id}`)}
            type="button"
          >
            <span
              className={`market-quick-visual quick-${index}`}
              aria-hidden="true"
            />
            <strong>{ui(locale, ru, uz, en)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function HomePage(props: CommonPageProps & { viewed: string[] }) {
  const { locale, products, navigate, favorites, viewed } = props;
  const copy = getMarketplaceCopy(locale);
  const preferred = [...new Set([...favorites, ...viewed])];
  const recommended = [...products]
    .sort((a, b) => {
      const ai = preferred.indexOf(a.id);
      const bi = preferred.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || b.rating - a.rating;
    })
    .slice(0, 6);
  const discounted = products
    .filter((product) => lowestOffer(product).oldPriceMinor)
    .slice(0, 6);
  const newItems = products.slice(8, 14);
  const nearby = products.slice(14, 20);
  const feed = products.slice(0, 24);
  const [visible, setVisible] = useState(12);
  const feedSentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = feedSentinel.current;
    if (!target || visible >= feed.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting)
          setVisible((count) => Math.min(count + 6, feed.length));
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [feed.length, visible]);
  const uniqueProducts = products.filter(
    (product, index, source) =>
      source.findIndex((item) => item.name.en === product.name.en) === index,
  );
  return (
    <div className="market-home-layout">
      <HomeSidebar locale={locale} navigate={navigate} />
      <div className="market-home-content">
        <section className="market-hero">
          <div>
            <span>
              {ui(
                locale,
                "ПЕЧАТЬ · ФОТО · ДИЗАЙН",
                "BOSMA · FOTO · DIZAYN",
                "PRINT · PHOTO · DESIGN",
              )}
            </span>
            <h1>
              {ui(
                locale,
                "Онлайн-печать и фотосервисы",
                "Onlayn bosma va foto xizmatlar",
                "Online printing and photo services",
              )}
            </h1>
            <p>
              {ui(
                locale,
                "Закажи прямо сейчас — получи быстро и удобно!",
                "Hozir buyurtma bering — tez va qulay oling!",
                "Order now — receive it quickly and easily!",
              )}
            </p>
            <div>
              <button
                onClick={() => navigate("/catalog?tab=services")}
                type="button"
              >
                {ui(
                  locale,
                  "Сделать заказ",
                  "Buyurtma berish",
                  "Place an order",
                )}{" "}
                →
              </button>
            </div>
          </div>
          <div className="market-hero-composition" aria-hidden="true" />
          <div className="market-hero-dots" aria-hidden="true">
            <b />
            <b />
            <b />
          </div>
        </section>
        <HomeServiceCategories locale={locale} navigate={navigate} />
        <HomePromotions locale={locale} navigate={navigate} />
        <QuickServices locale={locale} navigate={navigate} />
        <nav className="market-category-row" aria-label={copy.categories}>
          {marketplaceCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => navigate(`/category/${category.id}`)}
              type="button"
            >
              <Icon name={category.icon} />
              <span>{marketplaceText(category.label, locale)}</span>
            </button>
          ))}
        </nav>
        <Section
          action={() => navigate("/catalog?sort=popular")}
          title={copy.recommended}
        >
          <p className="market-hint">{copy.recommendationHint}</p>
          <ProductGrid
            items={
              recommended.length ? recommended : uniqueProducts.slice(0, 6)
            }
            {...props}
          />
        </Section>
        <section className="market-promo-grid">
          <button
            onClick={() => navigate("/catalog?sort=discount")}
            type="button"
          >
            <span>-20%</span>
            <strong>{copy.discounts}</strong>
            <small>{copy.synthetic}</small>
          </button>
          <button onClick={() => navigate("/category/gifts")} type="button">
            <span>NEW</span>
            <strong>{copy.gifts}</strong>
            <small>{copy.synthetic}</small>
          </button>
        </section>
        <Section
          action={() => navigate("/catalog?sort=discount")}
          title={copy.discounts}
        >
          <ProductGrid items={discounted} {...props} />
        </Section>
        <Section
          action={() => navigate("/catalog?sort=new")}
          title={copy.newItems}
        >
          <ProductGrid items={newItems} {...props} />
        </Section>
        <Section
          action={() => navigate("/catalog?seller=nearby")}
          title={copy.nearby}
        >
          <ProductGrid items={nearby} {...props} />
        </Section>
        <Section title={copy.more}>
          <div data-market-feed>
            <ProductGrid items={feed.slice(0, visible)} {...props} />
          </div>
          {visible < feed.length ? (
            <div className="market-feed-sentinel" ref={feedSentinel}>
              <button
                className="market-load-more"
                onClick={() =>
                  setVisible((count) => Math.min(count + 6, feed.length))
                }
                type="button"
              >
                {copy.more}
              </button>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function CatalogPage(props: CommonPageProps & { route: string }) {
  const copy = getMarketplaceCopy(props.locale);
  const params = new URLSearchParams(props.route.split("?")[1] ?? "");
  const routeCategory = props.route.match(/^\/category\/([^?]+)/)?.[1] as
    | MarketplaceCategory
    | undefined;
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState<MarketplaceCategory | "all">(
    routeCategory ?? "all",
  );
  const [sort, setSort] = useState(params.get("sort") ?? "popular");
  const [available, setAvailable] = useState(false);
  const [subcategory, setSubcategory] = useState("all");
  const [minimumRating, setMinimumRating] = useState("0");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const isServices = params.get("tab") === "services";
  const subcategories = useMemo(
    () =>
      Array.from(
        new Set(
          props.products
            .filter(
              (product) => category === "all" || product.category === category,
            )
            .map((product) => product.subcategory),
        ),
      ).sort(),
    [props.products, category],
  );
  const suggestions = useMemo(
    () =>
      props.products
        .filter((product) =>
          marketplaceText(product.name, props.locale)
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .slice(0, 5),
    [props.products, props.locale, query],
  );
  const filtered = useMemo(
    () =>
      props.products
        .filter((product) => {
          const text =
            `${product.name.ru} ${product.name.uz} ${product.name.en} ${product.subcategory}`.toLowerCase();
          const offer = lowestOffer(product);
          const productOverride = props.overrides[product.id];
          const effective =
            productOverride && offer.sellerId === "seller-agat"
              ? productOverride
              : { price: offer.priceMinor, stock: offer.stock };
          return (
            (category === "all" || product.category === category) &&
            (subcategory === "all" || product.subcategory === subcategory) &&
            (!query || text.includes(query.toLowerCase())) &&
            product.rating >= Number(minimumRating) &&
            (!available || effective.stock > 0) &&
            (!minPrice || effective.price >= Number(minPrice)) &&
            (!maxPrice || effective.price <= Number(maxPrice))
          );
        })
        .sort((a, b) =>
          sort === "price-asc"
            ? lowestOffer(a).priceMinor - lowestOffer(b).priceMinor
            : sort === "price-desc"
              ? lowestOffer(b).priceMinor - lowestOffer(a).priceMinor
              : sort === "rating"
                ? b.rating - a.rating
                : sort === "new"
                  ? b.imageIndex - a.imageIndex
                  : b.reviews - a.reviews,
        ),
    [
      props.products,
      props.overrides,
      category,
      subcategory,
      minimumRating,
      query,
      available,
      minPrice,
      maxPrice,
      sort,
    ],
  );
  return (
    <div className="market-catalog-page">
      <div className="market-page-heading">
        <div>
          <span>{copy.synthetic}</span>
          <h1>{isServices ? copy.serviceCatalog : copy.productCatalog}</h1>
        </div>
        <div className="market-tab-switch">
          <button
            className={!isServices ? "active" : ""}
            onClick={() => props.navigate("/catalog")}
            type="button"
          >
            {copy.catalogProducts}
          </button>
          <button
            className={isServices ? "active" : ""}
            onClick={() => props.navigate("/catalog?tab=services")}
            type="button"
          >
            {copy.catalogServices}
          </button>
        </div>
      </div>
      {isServices ? (
        <>
          <ServiceStrip locale={props.locale} navigate={props.navigate} />
          <div className="market-service-list">
            {premiumServices.map((service) => (
              <article key={service.id}>
                <div>
                  <h2>{localized(service.title, props.locale)}</h2>
                  <p>{localized(service.subtitle, props.locale)}</p>
                  <small>{localized(service.turnaround, props.locale)}</small>
                </div>
                <strong>
                  {copy.from} {money(service.basePrice, props.locale)}{" "}
                  {copy.sum}
                </strong>
                <button
                  onClick={() => props.navigate(`/service/${service.id}`)}
                  type="button"
                >
                  {copy.details}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="market-catalog-layout">
          <aside className="market-filter-panel">
            <h2>
              <Icon name="filter" /> {copy.filters}
            </h2>
            <label>
              {copy.search}
              <input
                list="market-catalog-suggestions"
                onChange={(event) => setQuery(event.target.value)}
                value={query}
              />
              <datalist id="market-catalog-suggestions">
                {suggestions.map((product) => (
                  <option
                    key={product.id}
                    value={marketplaceText(product.name, props.locale)}
                  />
                ))}
              </datalist>
            </label>
            <label>
              {copy.categories}
              <select
                onChange={(event) =>
                  setCategory(event.target.value as MarketplaceCategory | "all")
                }
                value={category}
              >
                <option value="all">{copy.all}</option>
                {marketplaceCategories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {marketplaceText(item.label, props.locale)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ui(props.locale, "Подкатегория", "Ichki toifa", "Subcategory")}
              <select
                onChange={(event) => setSubcategory(event.target.value)}
                value={subcategory}
              >
                <option value="all">{copy.all}</option>
                {subcategories.map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ui(props.locale, "Рейтинг от", "Reyting", "Minimum rating")}
              <select
                onChange={(event) => setMinimumRating(event.target.value)}
                value={minimumRating}
              >
                <option value="0">{copy.all}</option>
                <option value="4">4.0+</option>
                <option value="4.5">4.5+</option>
                <option value="4.8">4.8+</option>
              </select>
            </label>
            <label>
              {copy.sort}
              <select
                onChange={(event) => setSort(event.target.value)}
                value={sort}
              >
                <option value="popular">{copy.sortPopular}</option>
                <option value="price-asc">{copy.sortPriceAsc}</option>
                <option value="price-desc">{copy.sortPriceDesc}</option>
                <option value="rating">
                  {ui(
                    props.locale,
                    "По рейтингу",
                    "Reyting bo‘yicha",
                    "Rating",
                  )}
                </option>
                <option value="new">
                  {ui(props.locale, "Сначала новые", "Avval yangi", "Newest")}
                </option>
              </select>
            </label>
            <div className="market-price-filter">
              <label>
                {copy.priceFrom}
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setMinPrice(event.target.value.replace(/\D/g, ""))
                  }
                  value={minPrice}
                />
              </label>
              <label>
                {copy.priceTo}
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setMaxPrice(event.target.value.replace(/\D/g, ""))
                  }
                  value={maxPrice}
                />
              </label>
            </div>
            <label className="market-check">
              <input
                checked={available}
                onChange={(event) => setAvailable(event.target.checked)}
                type="checkbox"
              />
              {copy.onlyAvailable}
            </label>
            <button
              onClick={() => {
                setQuery("");
                setCategory("all");
                setSubcategory("all");
                setMinimumRating("0");
                setSort("popular");
                setAvailable(false);
                setMinPrice("");
                setMaxPrice("");
              }}
              type="button"
            >
              {copy.reset}
            </button>
          </aside>
          <div>
            <p className="market-results-count">
              {filtered.length} · {copy.synthetic}
            </p>
            {filtered.length ? (
              <ProductGrid items={filtered} {...props} />
            ) : (
              <div className="market-empty">{copy.nothing}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductPage(props: CommonPageProps & { slug: string }) {
  const copy = getMarketplaceCopy(props.locale);
  const product =
    props.products.find((item) => item.slug === props.slug) ??
    productBySlug(props.slug);
  const [variant, setVariant] = useState(0);
  const [gallery, setGallery] = useState(0);
  const [quantity, setQuantity] = useState(1);
  if (!product) return <div className="market-empty">{copy.nothing}</div>;
  const offer = lowestOffer(product);
  const seller = sellerById(offer.sellerId);
  const override = props.overrides[product.id];
  const price =
    override && offer.sellerId === "seller-agat"
      ? override.price
      : offer.priceMinor;
  const stock =
    override && offer.sellerId === "seller-agat" ? override.stock : offer.stock;
  const related = props.products
    .filter(
      (item) => item.id !== product.id && item.category === product.category,
    )
    .slice(0, 6);
  const recommended = props.products
    .filter(
      (item) => item.id !== product.id && item.category !== product.category,
    )
    .slice(0, 6);
  const addQuantity = () => {
    for (let index = 0; index < quantity; index += 1)
      props.addProduct(product, offer.id);
  };
  return (
    <div className="market-detail-page">
      <button
        className="market-back"
        onClick={() => history.back()}
        type="button"
      >
        ← {copy.back}
      </button>
      <div className="market-product-detail market-listing-detail">
        <div className="market-gallery">
          <div className="market-gallery-thumbs">
            {[0, 1, 2, 3].map((item) => (
              <button
                className={gallery === item ? "active" : ""}
                key={item}
                onClick={() => setGallery(item)}
                type="button"
              >
                <ProductImage
                  product={{
                    ...product,
                    imageIndex: (product.imageIndex + item) % 12,
                  }}
                />
              </button>
            ))}
          </div>
          <ProductImage
            className="detail-image"
            product={{
              ...product,
              imageIndex: (product.imageIndex + gallery) % 12,
            }}
          />
        </div>
        <div className="market-detail-copy market-buy-panel">
          <span>
            {marketplaceText(
              marketplaceCategories.find(
                (item) => item.id === product.category,
              )!.label,
              props.locale,
            )}
          </span>
          <h1>{marketplaceText(product.name, props.locale)}</h1>
          <div className="market-rating">
            <span>★ {product.rating}</span>
            <small>
              {product.reviews} {copy.reviews}
            </small>
            <small>
              · {ui(props.locale, "Артикул", "Artikul", "SKU")}:{" "}
              {product.id.slice(0, 18)}
            </small>
          </div>
          <p>{marketplaceText(product.description, props.locale)}</p>
          <h3>{ui(props.locale, "Вариант", "Variant", "Variant")}</h3>
          <div className="market-variants">
            {product.variants.map((item, index) => (
              <button
                className={variant === index ? "active" : ""}
                key={item.en}
                onClick={() => setVariant(index)}
                type="button"
              >
                {marketplaceText(item, props.locale)}
              </button>
            ))}
          </div>
          <div className="market-detail-price">
            {offer.oldPriceMinor ? (
              <del>
                {money(offer.oldPriceMinor, props.locale)} {copy.sum}
              </del>
            ) : null}
            <strong>
              {money(price, props.locale)} {copy.sum}
            </strong>
            {offer.oldPriceMinor ? (
              <b>-{Math.round((1 - price / offer.oldPriceMinor) * 100)}%</b>
            ) : null}
          </div>
          <div className="market-stock-line">
            <span>
              {stock > 0 ? `${copy.stock}: ${stock}` : copy.outOfStock}
            </span>
            <span>
              {copy.delivery}: {marketplaceText(seller.delivery, props.locale)}
            </span>
          </div>
          <div className="market-detail-actions">
            <div className="market-quantity">
              <button
                aria-label="−"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                type="button"
              >
                −
              </button>
              <span>{quantity}</span>
              <button
                aria-label="+"
                onClick={() =>
                  setQuantity((value) => Math.min(stock, value + 1))
                }
                type="button"
              >
                +
              </button>
            </div>
            <button disabled={stock < 1} onClick={addQuantity} type="button">
              <Icon name="cart" /> {copy.add}
            </button>
            <button
              className="market-buy-now"
              disabled={stock < 1}
              onClick={() => {
                addQuantity();
                props.navigate("/cart");
              }}
              type="button"
            >
              {ui(
                props.locale,
                "Купить сейчас",
                "Hozir xarid qilish",
                "Buy now",
              )}
            </button>
            <button
              aria-label={copy.favorites}
              aria-pressed={props.favorites.includes(product.id)}
              className="outline"
              onClick={() => props.toggleFavorite(product.id)}
              type="button"
            >
              <Icon name="heart" />
            </button>
          </div>
          <button
            className="market-product-seller"
            onClick={() => props.navigate(`/store/${seller.slug}`)}
            type="button"
          >
            <span>{seller.name.slice(0, 1)}</span>
            <div>
              <strong>{seller.name}</strong>
              <small>
                ★ {seller.rating} · {seller.reviews} {copy.reviews}
              </small>
            </div>
            <b>{copy.goToStore} →</b>
          </button>
        </div>
      </div>
      <div className="market-product-info-grid">
        <section>
          <h2>
            {ui(
              props.locale,
              "Характеристики",
              "Xususiyatlar",
              "Specifications",
            )}
          </h2>
          <dl>
            <div>
              <dt>{ui(props.locale, "Категория", "Toifa", "Category")}</dt>
              <dd>
                {marketplaceText(
                  marketplaceCategories.find(
                    (item) => item.id === product.category,
                  )!.label,
                  props.locale,
                )}
              </dd>
            </div>
            <div>
              <dt>{ui(props.locale, "Продавец", "Sotuvchi", "Seller")}</dt>
              <dd>{seller.name}</dd>
            </div>
            <div>
              <dt>{ui(props.locale, "Доставка", "Yetkazish", "Delivery")}</dt>
              <dd>{marketplaceText(seller.delivery, props.locale)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h2>{ui(props.locale, "Описание", "Tavsif", "Description")}</h2>
          <p>
            {marketplaceText(product.description, props.locale)}.{" "}
            {ui(
              props.locale,
              "Демонстрационная карточка: характеристики и цены синтетические.",
              "Demo karta: xususiyatlar va narxlar sintetik.",
              "Demo listing: specifications and prices are synthetic.",
            )}
          </p>
        </section>
        <section>
          <h2>{copy.reviews}</h2>
          <div className="market-review-grid">
            <article>
              <strong>★★★★★</strong>
              <p>
                {ui(
                  props.locale,
                  "Качественно упаковано, описание понятное.",
                  "Sifatli qadoqlangan, tavsifi tushunarli.",
                  "Packed well and clearly described.",
                )}
              </p>
              <small>{copy.synthetic}</small>
            </article>
            <article>
              <strong>★★★★★</strong>
              <p>
                {ui(
                  props.locale,
                  "Заказ подготовили вовремя.",
                  "Buyurtma o‘z vaqtida tayyorlandi.",
                  "The order was prepared on time.",
                )}
              </p>
              <small>{copy.synthetic}</small>
            </article>
          </div>
        </section>
      </div>
      <Section
        title={ui(
          props.locale,
          "Похожие товары",
          "O‘xshash mahsulotlar",
          "Similar products",
        )}
      >
        <ProductGrid items={related} {...props} />
      </Section>
      <Section
        title={ui(
          props.locale,
          "Рекомендуем",
          "Tavsiya qilamiz",
          "Recommended",
        )}
      >
        <ProductGrid items={recommended} {...props} />
      </Section>
    </div>
  );
}

function StorePage(props: CommonPageProps & { slug: string }) {
  const copy = getMarketplaceCopy(props.locale);
  const seller =
    marketplaceSellers.find((item) => item.slug === props.slug) ??
    marketplaceSellers[0]!;
  const products = props.products.filter((product) =>
    product.offers.some((offer) => offer.sellerId === seller.id),
  );
  return (
    <div className="market-store-page">
      <section className="market-store-hero">
        <div className="market-store-mark">{seller.name.slice(0, 1)}</div>
        <div>
          <span>{seller.verified ? `✓ ${copy.verified}` : copy.synthetic}</span>
          <h1>{seller.name}</h1>
          <p>{marketplaceText(seller.description, props.locale)}</p>
          <div>
            ★ {seller.rating} · {seller.reviews} {copy.reviews} ·{" "}
            {marketplaceText(seller.city, props.locale)}
          </div>
        </div>
      </section>
      <Section title={copy.storeProducts}>
        <ProductGrid items={products} {...props} />
      </Section>
      <Section title={copy.storeReviews}>
        <div className="market-review-grid">
          {[0, 1, 2].map((index) => (
            <article key={index}>
              <strong>★★★★★</strong>
              <p>
                {props.locale === "ru"
                  ? "Заказ был собран аккуратно и вовремя."
                  : props.locale === "uz"
                    ? "Buyurtma ehtiyotkorlik bilan va vaqtida tayyorlandi."
                    : "The order was prepared carefully and on time."}
              </p>
              <small>{copy.synthetic}</small>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}

function CartPage(
  props: CommonPageProps & {
    cart: Cart;
    setQuantity: (offerId: string, quantity: number) => void;
  },
) {
  const copy = getMarketplaceCopy(props.locale);
  const lines = Object.entries(props.cart).flatMap(([offerId, quantity]) =>
    props.products.flatMap((product) =>
      product.offers
        .filter((offer) => offer.id === offerId)
        .map((offer) => ({ product, offer, quantity })),
    ),
  );
  const groups = marketplaceSellers
    .map((seller) => ({
      seller,
      lines: lines.filter((line) => line.offer.sellerId === seller.id),
    }))
    .filter((group) => group.lines.length);
  const subtotal = lines.reduce(
    (sum, line) =>
      sum +
      effectiveOfferPrice(line.product, line.offer.id, props.overrides) *
        line.quantity,
    0,
  );
  return (
    <div className="market-cart-page">
      <div className="market-page-heading">
        <div>
          <span>{copy.synthetic}</span>
          <h1>{copy.cart}</h1>
        </div>
      </div>
      {groups.length ? (
        <div className="market-cart-layout">
          <div>
            {groups.map(({ seller, lines: sellerLines }) => (
              <section className="market-cart-group" key={seller.id}>
                <button
                  onClick={() => props.navigate(`/store/${seller.slug}`)}
                  type="button"
                >
                  <Icon name="store" /> {seller.name}
                </button>
                {sellerLines.map(({ product, offer, quantity }) => (
                  <article key={offer.id}>
                    <ProductImage product={product} />
                    <div>
                      <button
                        onClick={() => props.openProduct(product)}
                        type="button"
                      >
                        {marketplaceText(product.name, props.locale)}
                      </button>
                      <strong>
                        {money(
                          effectiveOfferPrice(
                            product,
                            offer.id,
                            props.overrides,
                          ),
                          props.locale,
                        )}{" "}
                        {copy.sum}
                      </strong>
                    </div>
                    <div className="market-quantity">
                      <button
                        onClick={() =>
                          props.setQuantity(offer.id, quantity - 1)
                        }
                        type="button"
                      >
                        −
                      </button>
                      <span>{quantity}</span>
                      <button
                        onClick={() =>
                          props.setQuantity(offer.id, quantity + 1)
                        }
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="remove"
                      onClick={() => props.setQuantity(offer.id, 0)}
                      type="button"
                    >
                      {copy.remove}
                    </button>
                  </article>
                ))}
              </section>
            ))}
          </div>
          <aside className="market-summary">
            <h2>{copy.total}</h2>
            <div>
              <span>{copy.subtotal}</span>
              <strong>
                {money(subtotal, props.locale)} {copy.sum}
              </strong>
            </div>
            <div>
              <span>{copy.demoDelivery}</span>
              <strong>0 {copy.sum}</strong>
            </div>
            <div className="total">
              <span>{copy.total}</span>
              <strong>
                {money(subtotal, props.locale)} {copy.sum}
              </strong>
            </div>
            <button onClick={() => props.navigate("/checkout")} type="button">
              {copy.checkout}
            </button>
            <small>{copy.demoPayment}</small>
          </aside>
        </div>
      ) : (
        <div className="market-empty">
          <Icon name="cart" size={48} />
          <h2>{copy.cartEmpty}</h2>
          <button onClick={() => props.navigate("/catalog")} type="button">
            {copy.heroAction}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckoutPage(
  props: CommonPageProps & {
    cart: Cart;
    createOrder: (fulfillment: "pickup" | "courier") => void;
  },
) {
  const copy = getMarketplaceCopy(props.locale);
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<"pickup" | "courier">("pickup");
  const total = Object.entries(props.cart).reduce(
    (sum, [offerId, quantity]) => {
      const product = props.products.find((item) =>
        item.offers.some((offer) => offer.id === offerId),
      );
      return (
        sum +
        (product ? effectiveOfferPrice(product, offerId, props.overrides) : 0) *
          quantity
      );
    },
    0,
  );
  return (
    <div className="market-checkout-page">
      <div className="market-page-heading">
        <div>
          <span>{copy.demoPayment}</span>
          <h1>{copy.checkoutTitle}</h1>
        </div>
      </div>
      <div className="market-checkout-grid">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (method === "pickup" || address.trim())
              props.createOrder(method);
          }}
        >
          <fieldset>
            <legend>{copy.fulfillment}</legend>
            <label className={method === "pickup" ? "selected" : ""}>
              <input
                checked={method === "pickup"}
                name="method"
                onChange={() => setMethod("pickup")}
                type="radio"
              />
              {copy.pickup}
            </label>
            <label className={method === "courier" ? "selected" : ""}>
              <input
                checked={method === "courier"}
                name="method"
                onChange={() => setMethod("courier")}
                type="radio"
              />
              {copy.courier}
            </label>
          </fieldset>
          {method === "courier" ? (
            <label>
              {copy.address}
              <input
                onChange={(event) => setAddress(event.target.value)}
                placeholder={copy.addressPlaceholder}
                required
                value={address}
              />
            </label>
          ) : null}
          <button disabled={!Object.keys(props.cart).length} type="submit">
            {copy.confirmOrder}
          </button>
        </form>
        <aside className="market-summary">
          <h2>{copy.total}</h2>
          <div className="total">
            <span>{copy.total}</span>
            <strong>
              {money(total, props.locale)} {copy.sum}
            </strong>
          </div>
          <p>{copy.demoPayment}</p>
        </aside>
      </div>
    </div>
  );
}

function AssignmentSimulation({
  service,
  locale,
  navigate,
}: {
  service: PremiumService;
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const copy = getMarketplaceCopy(locale);
  const ranked = useMemo(() => rankAssignmentCandidates(service), [service]);
  const eligible = useMemo(
    () => eligibleAssignmentCandidates(service),
    [service],
  );
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<
    Array<{ id: string; state: "declined" | "timeout" | "accepted" }>
  >([]);
  const [forceEmpty, setForceEmpty] = useState(false);
  const active = forceEmpty ? undefined : eligible[queueIndex];
  const accepted = history.find((event) => event.state === "accepted");
  const advance = (state: "declined" | "timeout") => {
    if (!active || accepted) return;
    setHistory((current) => [...current, { id: active.id, state }]);
    setQueueIndex((value) => value + 1);
  };
  const accept = () => {
    if (!active || accepted) return;
    setHistory((current) => [...current, { id: active.id, state: "accepted" }]);
  };
  const reset = () => {
    setQueueIndex(0);
    setHistory([]);
    setForceEmpty(false);
  };
  return (
    <div
      className="market-assignment"
      data-assignment-state={
        accepted ? "accepted" : active ? "offered" : "unavailable"
      }
    >
      <header>
        <Icon name={accepted ? "check" : "store"} size={54} />
        <div>
          <span>
            {ui(
              locale,
              "Автоматический подбор",
              "Avtomatik tanlash",
              "Automatic assignment",
            )}
          </span>
          <h1>
            {accepted
              ? ui(
                  locale,
                  "Исполнитель назначен",
                  "Ijrochi tayinlandi",
                  "Studio assigned",
                )
              : active
                ? ui(
                    locale,
                    "Ожидаем ответ студии",
                    "Studiya javobini kutmoqdamiz",
                    "Waiting for studio response",
                  )
                : ui(
                    locale,
                    "Сейчас нет доступного исполнителя",
                    "Hozir mos ijrochi yo‘q",
                    "No eligible studio is available",
                  )}
          </h1>
          <p>
            {accepted
              ? ui(
                  locale,
                  "Назначение защищено от повторного подтверждения в этой демонстрации.",
                  "Ushbu demoda takroriy tasdiqlashdan himoyalangan.",
                  "This demo protects the assignment from duplicate acceptance.",
                )
              : ui(
                  locale,
                  "Система проверяет услугу, оборудование, радиус, рейтинг и текущую загрузку.",
                  "Tizim xizmat, uskunalar, radius, reyting va joriy yuklamani tekshiradi.",
                  "The system checks service, equipment, radius, rating and current load.",
                )}
          </p>
        </div>
      </header>
      {active && !accepted ? (
        <article className="market-active-offer">
          <div>
            <strong>{active.name}</strong>
            <span>
              ★ {active.rating} · {active.distanceKm} km · {active.loadPercent}%
            </span>
          </div>
          <time>03:00</time>
        </article>
      ) : null}
      {accepted ? (
        <div className="market-assigned-studio">
          <strong>
            {eligible.find((item) => item.id === accepted.id)?.name}
          </strong>
          <span>
            {ui(
              locale,
              "Заказ принят в работу",
              "Buyurtma ishga qabul qilindi",
              "Order accepted for production",
            )}
          </span>
        </div>
      ) : null}
      <ol className="market-assignment-timeline">
        {history.map((event) => (
          <li key={`${event.id}-${event.state}`}>
            <b>{eligible.find((item) => item.id === event.id)?.name}</b>
            <span>
              {event.state === "declined"
                ? ui(locale, "Отказ", "Rad etildi", "Declined")
                : event.state === "timeout"
                  ? ui(
                      locale,
                      "Время ответа истекло",
                      "Javob vaqti tugadi",
                      "Offer timed out",
                    )
                  : ui(locale, "Принято", "Qabul qilindi", "Accepted")}
            </span>
          </li>
        ))}
      </ol>
      <details className="market-assignment-controls" open>
        <summary>
          {ui(
            locale,
            "Управление демонстрацией",
            "Demo boshqaruvi",
            "Demo controls",
          )}
        </summary>
        <div>
          <button
            disabled={!active || Boolean(accepted)}
            onClick={() => advance("declined")}
            type="button"
          >
            {ui(
              locale,
              "Симулировать отказ",
              "Rad etishni simulyatsiya qilish",
              "Simulate decline",
            )}
          </button>
          <button
            disabled={!active || Boolean(accepted)}
            onClick={() => advance("timeout")}
            type="button"
          >
            {ui(
              locale,
              "Симулировать тайм-аут",
              "Taym-autni simulyatsiya qilish",
              "Simulate timeout",
            )}
          </button>
          <button
            disabled={!active || Boolean(accepted)}
            onClick={accept}
            type="button"
          >
            {ui(
              locale,
              "Принять исполнителем",
              "Ijrochi qabul qiladi",
              "Accept as studio",
            )}
          </button>
          <button
            onClick={() => {
              setForceEmpty(true);
              setHistory([]);
            }}
            type="button"
          >
            {ui(locale, "Нет исполнителей", "Ijrochi yo‘q", "No candidates")}
          </button>
          <button onClick={reset} type="button">
            {ui(locale, "Повторить", "Qayta boshlash", "Reset")}
          </button>
        </div>
      </details>
      <details className="market-ranking-evidence">
        <summary>
          {ui(
            locale,
            "Почему такой порядок",
            "Nega bunday tartib",
            "Why this order",
          )}
        </summary>
        {ranked.map((candidate: RankedCandidate) => (
          <p key={candidate.id}>
            <strong>{candidate.name}</strong>
            <span>
              {candidate.outcome} · {candidate.score}
            </span>
          </p>
        ))}
      </details>
      <button
        className="market-assignment-history"
        onClick={() => navigate("/account/service-orders")}
        type="button"
      >
        {copy.orderHistory}
      </button>
    </div>
  );
}

function ServicePage({
  service,
  locale,
  navigate,
}: {
  service: PremiumService;
  locale: CustomerLocale;
  navigate: (path: string) => void;
}) {
  const copy = getMarketplaceCopy(locale);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const isComplex = ["design", "coursework", "presentations"].includes(
    service.id,
  );
  const multiplier = service.fields.reduce((value, field) => {
    const selected = field.options?.find(
      (option) => option.value === values[field.id],
    );
    return value * (selected?.multiplier ?? 1);
  }, 1);
  const quantity = Number(values.quantity || 1);
  const total = Math.round(
    service.basePrice * multiplier * Math.max(1, quantity),
  );
  const next = () => {
    if (
      step === 0 &&
      service.fields.some((field) => field.required && !values[field.id])
    ) {
      setError(copy.required);
      return;
    }
    if (step === 1 && isComplex && !values.brief?.trim()) {
      setError(copy.required);
      return;
    }
    if (
      step === 2 &&
      values.fulfillment === "courier" &&
      !values.address?.trim()
    ) {
      setError(copy.required);
      return;
    }
    setError("");
    setStep((value) => Math.min(3, value + 1));
  };
  if (complete)
    return (
      <AssignmentSimulation
        locale={locale}
        navigate={navigate}
        service={service}
      />
    );
  return (
    <div className="market-service-page">
      <button
        className="market-back"
        onClick={() => history.back()}
        type="button"
      >
        ← {copy.back}
      </button>
      <header>
        <span>{copy.serviceOrder}</span>
        <h1>{localized(service.title, locale)}</h1>
        <p>{localized(service.subtitle, locale)}</p>
      </header>
      <ol className="market-steps">
        {[copy.parameters, copy.files, copy.fulfillment, copy.confirmation].map(
          (label, index) => (
            <li className={index <= step ? "active" : ""} key={label}>
              <b>{index + 1}</b>
              <span>{label}</span>
            </li>
          ),
        )}
      </ol>
      <div className="market-service-form">
        {step === 0 ? (
          <div className="market-field-grid">
            {service.fields.map((field) => (
              <label key={field.id}>
                {localized(field.label, locale)}
                {field.type === "select" ? (
                  <select
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                    required={field.required}
                    value={values[field.id] ?? ""}
                  >
                    <option value="">—</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {localized(option.label, locale)}
                      </option>
                    ))}
                  </select>
                ) : field.type === "file" ? (
                  <input
                    accept=".pdf,.docx,.jpg,.jpeg,.png"
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.id]:
                          event.target.files?.[0]?.name ?? "demo-file",
                      }))
                    }
                    required={field.required}
                    type="file"
                  />
                ) : (
                  <input
                    max={field.max}
                    min={field.min}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                    required={field.required}
                    type={field.type}
                    value={values[field.id] ?? ""}
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}
        {step === 1 ? (
          <div className="market-materials">
            <Icon name="upload" size={48} />
            <h2>{copy.files}</h2>
            {isComplex ? (
              <label>
                {copy.brief}
                <textarea
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      brief: event.target.value,
                    }))
                  }
                  placeholder={copy.briefPlaceholder}
                  value={values.brief ?? ""}
                />
              </label>
            ) : (
              <p>{values.file || copy.attach}</p>
            )}
            <label>
              {copy.deadline}
              <input
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    deadline: event.target.value,
                  }))
                }
                type="date"
                value={values.deadline ?? ""}
              />
            </label>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="market-fulfillment-choice">
            <h2>{copy.fulfillment}</h2>
            <div>
              <button
                className={
                  (values.fulfillment ?? "pickup") === "pickup" ? "active" : ""
                }
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    fulfillment: "pickup",
                  }))
                }
                type="button"
              >
                <Icon name="store" />
                <strong>{copy.pickup}</strong>
                <span>
                  {ui(
                    locale,
                    "Пункт определится после назначения",
                    "Punkt tayinlashdan keyin aniqlanadi",
                    "Location is confirmed after assignment",
                  )}
                </span>
              </button>
              <button
                className={values.fulfillment === "courier" ? "active" : ""}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    fulfillment: "courier",
                  }))
                }
                type="button"
              >
                <Icon name="package" />
                <strong>{copy.courier}</strong>
                <span>
                  {ui(
                    locale,
                    "Синтетический адрес, без передачи данных",
                    "Sintetik manzil, ma’lumot uzatilmaydi",
                    "Synthetic address; no data is transmitted",
                  )}
                </span>
              </button>
            </div>
            {values.fulfillment === "courier" ? (
              <label>
                {copy.address}
                <input
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  placeholder={copy.addressPlaceholder}
                  value={values.address ?? ""}
                />
              </label>
            ) : null}
            <p>
              {ui(
                locale,
                "Исполнитель будет выбран автоматически после подтверждения.",
                "Ijrochi tasdiqlangandan so‘ng avtomatik tanlanadi.",
                "The studio will be assigned automatically after confirmation.",
              )}
            </p>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="market-confirm">
            <h2>{copy.confirmation}</h2>
            <p>{localized(service.title, locale)}</p>
            <strong>
              {copy.estimated}: {money(total, locale)} {copy.sum}
            </strong>
            <small>{copy.demoPayment}</small>
          </div>
        ) : null}
        {error ? (
          <p className="market-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="market-form-actions">
          {step > 0 ? (
            <button onClick={() => setStep((value) => value - 1)} type="button">
              {copy.back}
            </button>
          ) : null}
          <button
            onClick={step === 3 ? () => setComplete(true) : next}
            type="button"
          >
            {step === 3 ? copy.confirmService : copy.next}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountPage({
  section,
  orders,
  repeatOrder,
  ...props
}: CommonPageProps & {
  section: string;
  orders: DemoOrder[];
  repeatOrder: (order: DemoOrder) => void;
}) {
  const copy = getMarketplaceCopy(props.locale);
  const tabs = [
    ["overview", ui(props.locale, "Обзор", "Umumiy", "Overview")],
    [
      "profile",
      ui(
        props.locale,
        "Личные данные",
        "Shaxsiy ma’lumotlar",
        "Personal details",
      ),
    ],
    ["phone", ui(props.locale, "Телефон", "Telefon", "Phone")],
    ["addresses", copy.addresses],
    [
      "orders",
      ui(
        props.locale,
        "Товарные заказы",
        "Mahsulot buyurtmalari",
        "Product orders",
      ),
    ],
    [
      "service-orders",
      ui(props.locale, "Заказы услуг", "Xizmat buyurtmalari", "Service orders"),
    ],
    ["favorites", copy.favorites],
    ["notifications", copy.notifications],
    ["reviews", copy.buyerReviews],
    ["settings", copy.settings],
    ["support", copy.support],
  ];
  const [name, setName] = useState(read(STORAGE.profile, "Demo Customer"));
  const [message, setMessage] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<DemoOrder | null>(null);
  const demoOrders = orders.length
    ? orders
    : [
        {
          id: "DEMO-0175",
          createdAt: new Date().toISOString(),
          total: 174_000,
          fulfillment: "pickup" as const,
          status: "preparing" as const,
          items: [],
        },
      ];
  return (
    <div className="market-account-layout">
      <aside>
        <div className="market-account-person">
          <span>DC</span>
          <div>
            <strong>{name}</strong>
            <small>{copy.synthetic}</small>
          </div>
        </div>
        {tabs.map(([id, label]) => (
          <button
            className={section === id ? "active" : ""}
            key={id}
            onClick={() => props.navigate(`/account/${id}`)}
            type="button"
          >
            {label}
          </button>
        ))}
      </aside>
      <main>
        <div className="market-account-heading">
          <span>{copy.account}</span>
          <h1>{tabs.find(([id]) => id === section)?.[1] ?? copy.profile}</h1>
        </div>
        {section === "overview" ? (
          <>
            <div className="market-account-stats">
              <article>
                <span>
                  {ui(props.locale, "Заказы", "Buyurtmalar", "Orders")}
                </span>
                <strong>{demoOrders.length + 2}</strong>
              </article>
              <article>
                <span>{copy.favorites}</span>
                <strong>{props.favorites.length}</strong>
              </article>
              <article>
                <span>{copy.notifications}</span>
                <strong>3</strong>
              </article>
            </div>
            <section className="market-tracking-card">
              <div>
                <span>
                  {ui(
                    props.locale,
                    "Активный заказ",
                    "Faol buyurtma",
                    "Active order",
                  )}
                </span>
                <h2>DEMO-SERVICE-0175</h2>
              </div>
              <ol>
                <li className="done">{copy.statusCreated}</li>
                <li className="active">
                  {ui(
                    props.locale,
                    "Исполнитель назначен",
                    "Ijrochi tayinlandi",
                    "Studio assigned",
                  )}
                </li>
                <li>{copy.statusPreparing}</li>
                <li>{copy.statusReady}</li>
              </ol>
            </section>
            <div className="market-account-shortcuts">
              <button
                onClick={() => props.navigate("/account/orders")}
                type="button"
              >
                <Icon name="package" />
                <span>
                  {ui(
                    props.locale,
                    "Мои покупки",
                    "Xaridlarim",
                    "My purchases",
                  )}
                </span>
              </button>
              <button
                onClick={() => props.navigate("/account/service-orders")}
                type="button"
              >
                <Icon name="printer" />
                <span>
                  {ui(props.locale, "Мои услуги", "Xizmatlarim", "My services")}
                </span>
              </button>
              <button
                onClick={() => props.navigate("/account/support")}
                type="button"
              >
                <Icon name="headphones" />
                <span>{copy.support}</span>
              </button>
            </div>
          </>
        ) : null}
        {section === "orders" ? (
          <div className="market-order-list">
            {demoOrders.map((order) => (
              <article key={order.id}>
                <span>{order.id}</span>
                <strong>
                  {money(order.total, props.locale)} {copy.sum}
                </strong>
                <div>
                  <b>{copy.orderStatus}</b>
                  <span>
                    {order.status === "created"
                      ? copy.statusCreated
                      : order.status === "preparing"
                        ? copy.statusPreparing
                        : copy.statusReady}
                  </span>
                </div>
                <small>{new Date(order.createdAt).toLocaleString()}</small>
                <button onClick={() => setSelectedOrder(order)} type="button">
                  {copy.orderDetails}
                </button>
                <button onClick={() => repeatOrder(order)} type="button">
                  {ui(
                    props.locale,
                    "Повторить заказ",
                    "Qayta buyurtma",
                    "Order again",
                  )}
                </button>
              </article>
            ))}
            {selectedOrder ? (
              <section className="market-order-detail" aria-live="polite">
                <button
                  aria-label={ui(props.locale, "Закрыть", "Yopish", "Close")}
                  onClick={() => setSelectedOrder(null)}
                  type="button"
                >
                  ×
                </button>
                <span>{copy.orderDetails}</span>
                <h2>{selectedOrder.id}</h2>
                <ol>
                  <li className="done">{copy.statusCreated}</li>
                  <li
                    className={
                      selectedOrder.status !== "created" ? "done" : "active"
                    }
                  >
                    {copy.statusPreparing}
                  </li>
                  <li
                    className={selectedOrder.status === "ready" ? "done" : ""}
                  >
                    {copy.statusReady}
                  </li>
                </ol>
                <strong>
                  {money(selectedOrder.total, props.locale)} {copy.sum}
                </strong>
                <small>{copy.synthetic}</small>
              </section>
            ) : null}
          </div>
        ) : section === "service-orders" ? (
          <div className="market-order-list">
            <article>
              <span>DEMO-SERVICE-0175</span>
              <strong>
                {ui(
                  props.locale,
                  "Распечатка документов",
                  "Hujjatlarni chop etish",
                  "Document printing",
                )}
              </strong>
              <div>
                <b>{copy.orderStatus}</b>
                <span>
                  {ui(
                    props.locale,
                    "Студия готовит заказ",
                    "Studiya buyurtmani tayyorlamoqda",
                    "Studio is preparing the order",
                  )}
                </span>
              </div>
              <small>{copy.synthetic}</small>
              <button
                onClick={() =>
                  setMessage(
                    ui(
                      props.locale,
                      "Трекинг открыт",
                      "Kuzatuv ochildi",
                      "Tracking opened",
                    ),
                  )
                }
                type="button"
              >
                {ui(props.locale, "Отследить", "Kuzatish", "Track")}
              </button>
            </article>
          </div>
        ) : section === "favorites" ? (
          props.favorites.length ? (
            <ProductGrid
              items={props.products.filter((product) =>
                props.favorites.includes(product.id),
              )}
              {...props}
            />
          ) : (
            <div className="market-empty">{copy.cartEmpty}</div>
          )
        ) : section === "notifications" ? (
          <div className="market-notifications">
            <article>
              <Icon name="bell" />
              <div>
                <strong>{copy.orderCreated}</strong>
                <p>{copy.synthetic}</p>
              </div>
            </article>
            <article>
              <Icon name="star" />
              <div>
                <strong>{copy.recommended}</strong>
                <p>{copy.recommendationHint}</p>
              </div>
            </article>
          </div>
        ) : section !== "overview" &&
          section !== "orders" &&
          section !== "service-orders" ? (
          <form
            className="market-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              localStorage.setItem(STORAGE.profile, JSON.stringify(name));
              setMessage(copy.saved);
            }}
          >
            <label>
              {copy.profile}
              <input
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <label>
              {section === "addresses"
                ? copy.address
                : section === "phone"
                  ? ui(
                      props.locale,
                      "Номер телефона (демо)",
                      "Telefon raqami (demo)",
                      "Phone number (demo)",
                    )
                  : copy.settings}
              <textarea
                defaultValue={
                  section === "addresses"
                    ? ui(
                        props.locale,
                        "Ташкент, демо-адрес",
                        "Toshkent, demo manzil",
                        "Tashkent, demo address",
                      )
                    : copy.synthetic
                }
              />
            </label>
            <button type="submit">{copy.save}</button>
          </form>
        ) : null}
        {message ? (
          <div className="market-account-message" role="status">
            {message}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function SellerPage({
  locale,
  section,
  products,
  overrides,
  updateOverride,
  addSellerProduct,
  orders,
  updateOrderStatus,
  navigate,
}: {
  locale: CustomerLocale;
  section: string;
  products: MarketplaceProduct[];
  overrides: SellerOverride;
  updateOverride: (id: string, value: SellerOverride[string]) => void;
  addSellerProduct: (product: MarketplaceProduct) => void;
  orders: DemoOrder[];
  updateOrderStatus: (id: string) => void;
  navigate: (path: string) => void;
}) {
  const copy = getMarketplaceCopy(locale);
  const own = products.filter((product) =>
    product.offers.some((offer) => offer.sellerId === "seller-agat"),
  );
  const [selected, setSelected] = useState(own[0]!);
  const offer = selected.offers.find(
    (item) => item.sellerId === "seller-agat",
  )!;
  const current = overrides[selected.id] ?? {
    price: offer.priceMinor,
    stock: offer.stock,
  };
  const [price, setPrice] = useState(String(current.price));
  const [stock, setStock] = useState(String(current.stock));
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("45000");
  const [newStock, setNewStock] = useState("10");
  const [newImage, setNewImage] = useState<string | undefined>();
  const [storeName, setStoreName] = useState("AGAT PRINT Tashkent");
  const [sellerNotice, setSellerNotice] = useState("");
  const tabs = [
    ["dashboard", copy.analytics],
    ["products", copy.assortment],
    ["orders", copy.sellerOrders],
    ["settings", copy.storeSettings],
  ];
  useEffect(() => {
    const next = overrides[selected.id] ?? {
      price: offer.priceMinor,
      stock: offer.stock,
    };
    setPrice(String(next.price));
    setStock(String(next.stock));
  }, [selected, overrides, offer.priceMinor, offer.stock]);
  return (
    <div className="market-seller-layout">
      <aside>
        <h2>{copy.sellerDashboard}</h2>
        {tabs.map(([id, label]) => (
          <button
            className={section === id ? "active" : ""}
            key={id}
            onClick={() => navigate(`/seller/${id}`)}
            type="button"
          >
            {label}
          </button>
        ))}
      </aside>
      <main>
        <div className="market-page-heading">
          <div>
            <span>{copy.localChanges}</span>
            <h1>
              {tabs.find(([id]) => id === section)?.[1] ?? copy.analytics}
            </h1>
          </div>
        </div>
        {section === "dashboard" ? (
          <>
            <section className="market-seller-onboarding">
              <div>
                <span>{copy.synthetic}</span>
                <h2>
                  {ui(
                    locale,
                    "Магазин готов к работе",
                    "Do‘kon ishga tayyor",
                    "Store is ready",
                  )}
                </h2>
                <p>{copy.localChanges}</p>
              </div>
              <ol>
                <li className="done">
                  {ui(
                    locale,
                    "Регистрация",
                    "Ro‘yxatdan o‘tish",
                    "Registration",
                  )}
                </li>
                <li className="done">
                  {ui(
                    locale,
                    "Профиль магазина",
                    "Do‘kon profili",
                    "Store profile",
                  )}
                </li>
                <li className="done">
                  {ui(locale, "Демо-проверка", "Demo tekshiruv", "Demo review")}
                </li>
              </ol>
            </section>
            <div className="market-stat-grid">
              <article>
                <span>{copy.sales}</span>
                <strong>128</strong>
              </article>
              <article>
                <span>{copy.revenue}</span>
                <strong>8 420 000 {copy.sum}</strong>
              </article>
              <article>
                <span>{copy.inventory}</span>
                <strong>
                  {own.reduce(
                    (sum, product) =>
                      sum +
                      (overrides[product.id]?.stock ??
                        product.offers.find(
                          (item) => item.sellerId === "seller-agat",
                        )?.stock ??
                        0),
                    0,
                  )}
                </strong>
              </article>
            </div>
          </>
        ) : section === "products" ? (
          <div className="market-seller-products-wrap">
            <form
              className="market-seller-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newName.trim()) return;
                const id = `custom-${Date.now()}`;
                addSellerProduct({
                  id,
                  slug: id,
                  category: "stationery",
                  subcategory: "seller-demo",
                  name: { ru: newName, uz: newName, en: newName },
                  description: {
                    ru: "Демонстрационный товар продавца",
                    uz: "Sotuvchining demo mahsuloti",
                    en: "Seller demo product",
                  },
                  rating: 5,
                  reviews: 0,
                  variants: [
                    { ru: "Стандарт", uz: "Standart", en: "Standard" },
                  ],
                  imageSheet: "office",
                  imageIndex: 0,
                  ...(newImage ? { imageDataUrl: newImage } : {}),
                  badge: { ru: "Демо", uz: "Demo", en: "Demo" },
                  offers: [
                    {
                      id: `offer-${id}`,
                      sellerId: "seller-agat",
                      priceMinor: Math.max(1, Number(newPrice)),
                      stock: Math.max(0, Number(newStock)),
                      deliveryDays: 1,
                    },
                  ],
                });
                setNewName("");
                setNewImage(undefined);
              }}
            >
              <h2>{copy.addProduct}</h2>
              <label>
                {copy.productName}
                <input
                  onChange={(event) => setNewName(event.target.value)}
                  required
                  value={newName}
                />
              </label>
              <label>
                {copy.price}
                <input
                  min="1"
                  onChange={(event) => setNewPrice(event.target.value)}
                  required
                  type="number"
                  value={newPrice}
                />
              </label>
              <label>
                {copy.inventory}
                <input
                  min="0"
                  onChange={(event) => setNewStock(event.target.value)}
                  required
                  type="number"
                  value={newStock}
                />
              </label>
              <label>
                {copy.attach}
                <input
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.addEventListener("load", () => {
                      if (typeof reader.result === "string")
                        setNewImage(reader.result);
                    });
                    reader.readAsDataURL(file);
                  }}
                  type="file"
                />
              </label>
              <button type="submit">{copy.addProduct}</button>
            </form>
            <div className="market-seller-products">
              <div className="market-seller-list">
                {own.map((product) => (
                  <button
                    className={selected.id === product.id ? "active" : ""}
                    key={product.id}
                    onClick={() => setSelected(product)}
                    type="button"
                  >
                    <ProductImage product={product} />
                    <span>{marketplaceText(product.name, locale)}</span>
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  updateOverride(selected.id, {
                    price: Math.max(1, Number(price)),
                    stock: Math.max(0, Number(stock)),
                  });
                }}
              >
                <ProductImage product={selected} />
                <h2>{marketplaceText(selected.name, locale)}</h2>
                <label>
                  {copy.price}
                  <input
                    min="1"
                    onChange={(event) => setPrice(event.target.value)}
                    type="number"
                    value={price}
                  />
                </label>
                <label>
                  {copy.inventory}
                  <input
                    min="0"
                    onChange={(event) => setStock(event.target.value)}
                    type="number"
                    value={stock}
                  />
                </label>
                <button type="submit">{copy.updateProduct}</button>
              </form>
            </div>
          </div>
        ) : section === "orders" ? (
          <div className="market-order-list">
            {orders.length ? (
              orders.map((order) => (
                <article key={order.id}>
                  <strong>{order.id}</strong>
                  <span>
                    {money(order.total, locale)} {copy.sum}
                  </span>
                  <small>
                    {copy.orderStatus}: {order.status}
                  </small>
                  <button
                    disabled={order.status === "ready"}
                    onClick={() => updateOrderStatus(order.id)}
                    type="button"
                  >
                    {order.status === "created"
                      ? copy.statusPreparing
                      : copy.statusReady}
                  </button>
                </article>
              ))
            ) : (
              <div className="market-empty">{copy.cartEmpty}</div>
            )}
          </div>
        ) : section === "settings" ? (
          <form
            className="market-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSellerNotice(copy.saved);
            }}
          >
            <label>
              {ui(locale, "Название магазина", "Do‘kon nomi", "Store name")}
              <input
                onChange={(event) => setStoreName(event.target.value)}
                required
                value={storeName}
              />
            </label>
            <label>
              {ui(
                locale,
                "Описание и условия",
                "Tavsif va shartlar",
                "Description and terms",
              )}
              <textarea defaultValue={copy.localChanges} />
            </label>
            <button type="submit">{copy.save}</button>
            {sellerNotice ? <p role="status">{sellerNotice}</p> : null}
          </form>
        ) : (
          <div className="market-placeholder-panel">
            <Icon
              name={section === "orders" ? "package" : "settings"}
              size={52}
            />
            <h2>
              {section === "orders" ? copy.sellerOrders : copy.storeSettings}
            </h2>
            <p>{copy.localChanges}</p>
            <button onClick={() => navigate("/seller/products")} type="button">
              {copy.assortment}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export function MarketplaceApp() {
  const [locale, setLocale] = useState<CustomerLocale>(() =>
    localeFrom(new URLSearchParams(location.search).get("lang")),
  );
  const [route, setRoute] = useState(routeFromLocation);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [cart, setCart] = useState<Cart>(() => read(STORAGE.cart, {}));
  const [favorites, setFavorites] = useState<string[]>(() =>
    read(STORAGE.favorites, []),
  );
  const [viewed, setViewed] = useState<string[]>(() => read(STORAGE.views, []));
  const [orders, setOrders] = useState<DemoOrder[]>(() =>
    read(STORAGE.orders, []),
  );
  const [overrides, setOverrides] = useState<SellerOverride>(() =>
    read(STORAGE.seller, {}),
  );
  const [customProducts, setCustomProducts] = useState<MarketplaceProduct[]>(
    () => read(STORAGE.customProducts, []),
  );
  const scrollPositions = useRef<Record<string, number>>(
    read(STORAGE.scroll, {}),
  );
  const copy = getMarketplaceCopy(locale);
  const products = useMemo(
    () => asSellerListings([...marketplaceProducts, ...customProducts]),
    [customProducts],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE.cart, JSON.stringify(cart));
  }, [cart]);
  useEffect(() => {
    localStorage.setItem(STORAGE.favorites, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem(STORAGE.views, JSON.stringify(viewed));
  }, [viewed]);
  useEffect(() => {
    localStorage.setItem(STORAGE.orders, JSON.stringify(orders));
  }, [orders]);
  useEffect(() => {
    localStorage.setItem(STORAGE.seller, JSON.stringify(overrides));
  }, [overrides]);
  useEffect(() => {
    localStorage.setItem(
      STORAGE.customProducts,
      JSON.stringify(customProducts),
    );
  }, [customProducts]);
  useEffect(() => {
    const pop = () => setRoute(routeFromLocation());
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      scrollTo({
        top: scrollPositions.current[route.split("?")[0] ?? "/"] ?? 0,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [route]);
  useEffect(() => {
    const save = () => {
      scrollPositions.current[route.split("?")[0] ?? "/"] = scrollY;
      localStorage.setItem(
        STORAGE.scroll,
        JSON.stringify(scrollPositions.current),
      );
    };
    addEventListener("scroll", save, { passive: true });
    return () => removeEventListener("scroll", save);
  }, [route]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const update = () => setShowBackToTop(scrollY > 560);
    update();
    addEventListener("scroll", update, { passive: true });
    return () => removeEventListener("scroll", update);
  }, []);

  const navigate = useCallback((path: string) => {
    const next = `${PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
    history.pushState({}, "", next);
    setRoute(routeFromLocation());
    setCatalogOpen(false);
    setMobileOpen(false);
  }, []);
  const openProduct = useCallback(
    (product: MarketplaceProduct) => {
      setViewed((current) =>
        [product.id, ...current.filter((id) => id !== product.id)].slice(0, 12),
      );
      navigate(`/product/${product.slug}`);
    },
    [navigate],
  );
  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const active = current.includes(id);
      setToast(active ? copy.favoriteRemoved : copy.favoriteAdded);
      return active ? current.filter((item) => item !== id) : [...current, id];
    });
  };
  const addProduct = (product: MarketplaceProduct, offerId?: string) => {
    const offer = offerId
      ? (product.offers.find((item) => item.id === offerId) ??
        lowestOffer(product))
      : lowestOffer(product);
    setCart((current) => ({
      ...current,
      [offer.id]: (current[offer.id] ?? 0) + 1,
    }));
    setToast(copy.added);
  };
  const setQuantity = (offerId: string, quantity: number) =>
    setCart((current) => {
      const next = { ...current };
      if (quantity < 1) delete next[offerId];
      else next[offerId] = Math.min(quantity, 99);
      return next;
    });
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const createOrder = (fulfillment: "pickup" | "courier") => {
    const total = Object.entries(cart).reduce((sum, [offerId, quantity]) => {
      const product = products.find((item) =>
        item.offers.some((offer) => offer.id === offerId),
      );
      return (
        sum +
        (product ? effectiveOfferPrice(product, offerId, overrides) : 0) *
          quantity
      );
    }, 0);
    const order: DemoOrder = {
      id: `DEMO-${String(orders.length + 1).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
      total,
      fulfillment,
      status: "created",
      items: Object.entries(cart).map(([offerId, quantity]) => ({
        offerId,
        quantity,
      })),
    };
    setOrders((current) => [order, ...current]);
    setCart({});
    setToast(copy.orderCreated);
    navigate("/account/orders");
  };
  const repeatOrder = (order: DemoOrder) => {
    setCart(
      order.items.reduce<Cart>((next, item) => {
        next[item.offerId] = item.quantity;
        return next;
      }, {}),
    );
    setToast(
      ui(
        locale,
        "Товары снова добавлены в корзину",
        "Mahsulotlar yana savatga qo‘shildi",
        "Items were added to the cart again",
      ),
    );
    navigate("/cart");
  };
  const updateOverride = (id: string, value: SellerOverride[string]) => {
    setOverrides((current) => ({ ...current, [id]: value }));
    setToast(copy.saved);
  };
  const addSellerProduct = (product: MarketplaceProduct) => {
    setCustomProducts((current) => [...current, product]);
    setToast(copy.saved);
  };
  const updateOrderStatus = (id: string) => {
    setOrders((current) =>
      current.map((order) =>
        order.id !== id
          ? order
          : {
              ...order,
              status:
                order.status === "created"
                  ? "preparing"
                  : order.status === "preparing"
                    ? "ready"
                    : "ready",
            },
      ),
    );
    setToast(copy.saved);
  };
  const changeLocale = (next: CustomerLocale) => {
    setLocale(next);
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    history.replaceState({}, "", url);
    setRoute(routeFromLocation());
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    navigate(`/catalog?q=${encodeURIComponent(query)}`);
  };
  const cleanPath = route.split("?")[0] ?? "/";
  const common: CommonPageProps = {
    locale,
    products,
    favorites,
    overrides,
    openProduct,
    toggleFavorite,
    addProduct,
    navigate,
  };
  let page: React.ReactNode;
  const productSlug = cleanPath.match(/^\/product\/([^/]+)/)?.[1];
  const storeSlug = cleanPath.match(/^\/store\/([^/]+)/)?.[1];
  const serviceId = cleanPath.match(/^\/service\/([^/]+)/)?.[1];
  const accountSection =
    cleanPath.match(/^\/account\/([^/]+)/)?.[1] ?? "overview";
  const sellerSection =
    cleanPath.match(/^\/seller\/([^/]+)/)?.[1] ?? "dashboard";
  if (productSlug) page = <ProductPage {...common} slug={productSlug} />;
  else if (storeSlug) page = <StorePage {...common} slug={storeSlug} />;
  else if (serviceId)
    page = (
      <ServicePage
        locale={locale}
        navigate={navigate}
        service={
          premiumServices.find((item) => item.id === serviceId) ??
          premiumServices[0]!
        }
      />
    );
  else if (cleanPath === "/cart")
    page = <CartPage {...common} cart={cart} setQuantity={setQuantity} />;
  else if (cleanPath === "/checkout")
    page = <CheckoutPage {...common} cart={cart} createOrder={createOrder} />;
  else if (cleanPath.startsWith("/account"))
    page = (
      <AccountPage
        {...common}
        orders={orders}
        repeatOrder={repeatOrder}
        section={accountSection}
      />
    );
  else if (cleanPath.startsWith("/seller"))
    page = (
      <SellerPage
        addSellerProduct={addSellerProduct}
        locale={locale}
        navigate={navigate}
        overrides={overrides}
        orders={orders}
        products={products}
        section={sellerSection}
        updateOrderStatus={updateOrderStatus}
        updateOverride={updateOverride}
      />
    );
  else if (cleanPath === "/catalog" || cleanPath.startsWith("/category/"))
    page = <CatalogPage {...common} route={route} />;
  else page = <HomePage {...common} viewed={viewed} />;

  return (
    <div className="market-app">
      <header className="market-header">
        <div className="market-header-main">
          <button
            className="market-brand"
            onClick={() => navigate("/")}
            type="button"
          >
            <b>{marketplaceBrand.shortMark}</b>
            <span>
              <strong>{marketplaceBrand.name}</strong>
              <small>{marketplaceBrand.descriptor}</small>
            </span>
          </button>
          <button
            className="market-header-location"
            onClick={() => navigate("/store/agat-print-tashkent")}
            type="button"
          >
            <Icon name="location" size={22} />
            <span>
              <strong>{ui(locale, "Ташкент", "Toshkent", "Tashkent")}</strong>
              <small>
                {ui(
                  locale,
                  "Рядом с вами — рынок Кадышева",
                  "Yaqiningizda — Qodisheva bozori",
                  "Near you — Kadysheva market",
                )}
              </small>
            </span>
            <Icon name="arrow" size={14} />
          </button>
          <form className="market-search" onSubmit={search}>
            <Icon name="search" />
            <input
              aria-label={copy.search}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              value={query}
            />
            <button type="submit">{copy.searchAction}</button>
          </form>
          <nav className="market-header-actions">
            <button
              onClick={() => navigate("/account/favorites")}
              type="button"
            >
              <Icon name="heart" />
              <span>{copy.favorites}</span>
              <b>{favorites.length}</b>
            </button>
            <button onClick={() => navigate("/cart")} type="button">
              <Icon name="cart" />
              <span>{copy.cart}</span>
              <b>{cartCount}</b>
            </button>
            <div
              className="market-language-switch"
              aria-label={ui(locale, "Язык", "Til", "Language")}
            >
              {(["ru", "uz", "en"] as CustomerLocale[]).map((item) => (
                <button
                  aria-pressed={locale === item}
                  key={item}
                  onClick={() => changeLocale(item)}
                  type="button"
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="market-login-button"
              onClick={() => navigate("/account/overview")}
              type="button"
            >
              <Icon name="user" />
              <span className="sr-only">{copy.account}</span>
              <span>{ui(locale, "Войти", "Kirish", "Sign in")}</span>
            </button>
          </nav>
          <button
            className="market-mobile-menu"
            onClick={() => setMobileOpen((value) => !value)}
            type="button"
          >
            <Icon name="grid" />
            <span className="sr-only">{copy.menu}</span>
          </button>
        </div>
        <nav className={`market-nav ${mobileOpen ? "open" : ""}`}>
          <button
            className={cleanPath === "/" ? "active" : ""}
            onClick={() => navigate("/")}
            type="button"
          >
            {copy.home}
          </button>
          <button onClick={() => navigate("/catalog")} type="button">
            {copy.products}
          </button>
          <button
            onClick={() => navigate("/catalog?tab=services")}
            type="button"
          >
            {copy.services}
          </button>
          <button
            onClick={() => navigate(`/store/${marketplaceSellers[0]!.slug}`)}
            type="button"
          >
            {copy.stores}
          </button>
          <button onClick={() => navigate("/seller/dashboard")} type="button">
            {copy.seller}
          </button>
          <span>{copy.location}</span>
        </nav>
        {catalogOpen ? (
          <div className="market-mega-menu">
            <section>
              <h2>{copy.catalogProducts}</h2>
              {marketplaceCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => navigate(`/category/${category.id}`)}
                  type="button"
                >
                  <Icon name={category.icon} />
                  <span>{marketplaceText(category.label, locale)}</span>
                  <Icon name="arrow" size={17} />
                </button>
              ))}
            </section>
            <section>
              <h2>{copy.catalogServices}</h2>
              {premiumServices.map((service) => (
                <button
                  key={service.id}
                  onClick={() => navigate(`/service/${service.id}`)}
                  type="button"
                >
                  <Icon name="star" />
                  <span>{localized(service.title, locale)}</span>
                  <Icon name="arrow" size={17} />
                </button>
              ))}
            </section>
          </div>
        ) : null}
      </header>
      <main className="market-main">
        <MarketplaceBreadcrumbs
          locale={locale}
          navigate={navigate}
          path={cleanPath}
        />
        {page}
      </main>
      <nav className="market-bottom-nav">
        <button
          className={cleanPath === "/" ? "active" : ""}
          onClick={() => navigate("/")}
          type="button"
        >
          <Icon name="home" />
          <span>{copy.home}</span>
        </button>
        <button onClick={() => navigate("/catalog")} type="button">
          <Icon name="grid" />
          <span>{copy.catalog}</span>
        </button>
        <button onClick={() => navigate("/account/favorites")} type="button">
          <Icon name="heart" />
          <span>{copy.favorites}</span>
        </button>
        <button onClick={() => navigate("/cart")} type="button">
          <Icon name="cart" />
          <span>{copy.cart}</span>
          <b>{cartCount}</b>
        </button>
        <button onClick={() => navigate("/account/overview")} type="button">
          <Icon name="user" />
          <span>{copy.account}</span>
        </button>
      </nav>
      {toast ? (
        <div className="market-toast" role="status">
          {toast}
        </div>
      ) : null}
      {showBackToTop ? (
        <button
          aria-label={ui(locale, "Наверх", "Yuqoriga", "Back to top")}
          className="market-back-to-top"
          onClick={() =>
            scrollTo({
              top: 0,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
          type="button"
        >
          <Icon name="up" />
        </button>
      ) : null}
    </div>
  );
}
