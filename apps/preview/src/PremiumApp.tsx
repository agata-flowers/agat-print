import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localeFrom, type CustomerLocale } from "@agat/i18n";
import { getPremiumCopy } from "./premium-copy";
import {
  categories,
  createProductFeed,
  localized,
  type PremiumCategory,
  type PremiumProduct,
} from "./premium-data";
import {
  premiumServices,
  serviceText,
  textFor,
  type PremiumService,
} from "./premium-services";
import "./premium.css";

type Cart = Record<string, number>;
type ServiceValues = Record<string, string>;
const CART_KEY = "agat-premium-demo-cart";
const FAVORITES_KEY = "agat-premium-demo-favorites";
const SCROLL_KEY = "agat-premium-demo-scroll";
const SERVICE_KEY = "agat-premium-demo-service";

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};
const money = (amount: number, locale: CustomerLocale) =>
  new Intl.NumberFormat(
    locale === "uz" ? "uz-UZ" : locale === "ru" ? "ru-RU" : "en-US",
  ).format(amount);

function Icon({ name, size = 30 }: { name: string; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, React.ReactNode> = {
    home: <path {...common} d="M4 11 12 4l8 7v9H7v-7h10v7" />,
    portrait: (
      <>
        <circle {...common} cx="12" cy="8" r="3" />
        <path {...common} d="M6 20c.5-4 2.5-6 6-6s5.5 2 6 6M4 3h16v18H4z" />
      </>
    ),
    printer: (
      <>
        <path {...common} d="M7 8V3h10v5M7 18H4V9h16v9h-3M7 14h10v7H7z" />
        <circle cx="17" cy="11" r="1" fill="currentColor" />
      </>
    ),
    billboard: (
      <>
        <path {...common} d="M3 4h18v11H3zM8 15l-2 6M16 15l2 6M7 21h10" />
        <path {...common} d="m6 12 3-3 3 2 4-4 3 3" />
      </>
    ),
    slides: (
      <>
        <path {...common} d="M4 4h16v11H4zM8 20l4-5 4 5M7 8h5M7 11h8" />
      </>
    ),
    book: (
      <>
        <path
          {...common}
          d="M3 5c4-1 7 0 9 2v14c-2-2-5-3-9-2zM21 5c-4-1-7 0-9 2v14c2-2 5-3 9-2z"
        />
      </>
    ),
    pen: (
      <>
        <path {...common} d="m4 20 4-1 11-11-3-3L5 16zM14 7l3 3M4 20l2-4" />
      </>
    ),
    stationery: (
      <>
        <path {...common} d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />
      </>
    ),
    gift: (
      <>
        <path
          {...common}
          d="M3 9h18v12H3zM12 9v12M2 6h20v3H2zM12 6c-2-5-7-3-5 0M12 6c2-5 7-3 5 0"
        />
      </>
    ),
    accessories: (
      <>
        <path {...common} d="M5 8h14l1 13H4zM8 9V6a4 4 0 0 1 8 0v3" />
      </>
    ),
    heart: (
      <path
        {...common}
        d="M20.8 5.8c-2-2.1-5.5-2-7.5.2L12 7.4 10.7 6C8.7 3.8 5.2 3.7 3.2 5.8c-2 2.1-1.9 5.5.2 7.5L12 21l8.6-7.7c2.1-2 2.2-5.4.2-7.5Z"
      />
    ),
    cart: (
      <>
        <path
          {...common}
          d="M3 4h2l2.2 10h10.6l2-7H6M9 19a1.5 1.5 0 1 0 0 .1M17 19a1.5 1.5 0 1 0 0 .1"
        />
      </>
    ),
    search: (
      <>
        <circle {...common} cx="11" cy="11" r="7" />
        <path {...common} d="m20 20-4-4" />
      </>
    ),
    user: (
      <>
        <circle {...common} cx="12" cy="8" r="4" />
        <path {...common} d="M4 21c1-5 3.5-7 8-7s7 2 8 7" />
      </>
    ),
    upload: <path {...common} d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />,
    check: <path {...common} d="m5 12 4 4L19 6" />,
    truck: (
      <>
        <path {...common} d="M3 5h11v12H3zM14 10h4l3 3v4h-7z" />
        <circle {...common} cx="7" cy="19" r="2" />
        <circle {...common} cx="17" cy="19" r="2" />
      </>
    ),
    shield: (
      <>
        <path {...common} d="M12 3 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z" />
        <path {...common} d="m8 12 3 3 5-6" />
      </>
    ),
    tag: (
      <>
        <path {...common} d="M3 12 12 3h8v8l-9 9z" />
        <circle {...common} cx="16" cy="7" r="1" />
      </>
    ),
    photo: (
      <>
        <path {...common} d="M3 5h18v14H3zM6 16l4-5 3 3 2-2 3 4" />
        <circle {...common} cx="16" cy="9" r="2" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className="premium-icon"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name] ?? paths.photo}
    </svg>
  );
}

function Logo() {
  return (
    <span className="premium-logo" aria-label="AGAT PRINT">
      <span className="premium-logo-mark">A</span>
      <span>
        <strong>AGAT PRINT</strong>
        <small>we print your ideas</small>
      </span>
    </span>
  );
}
function ProductVisual({
  product,
  large = false,
}: {
  product: PremiumProduct;
  large?: boolean;
}) {
  const iconName =
    product.category === "stationery"
      ? "stationery"
      : product.category === "gifts"
        ? "gift"
        : "accessories";
  return (
    <div
      className={`premium-product-visual tone-${product.tone}${large ? " large" : ""}`}
    >
      <span className="visual-orbit" />
      <span className="visual-object">
        <Icon name={iconName} size={large ? 92 : 62} />
      </span>
      <span className="visual-shadow" />
      <span className="visual-brand">AGAT</span>
    </div>
  );
}

function ProductCard({
  product,
  locale,
  favorite,
  onFavorite,
  onAdd,
  onOpen,
}: {
  product: PremiumProduct;
  locale: CustomerLocale;
  favorite: boolean;
  onFavorite: () => void;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const copy = getPremiumCopy(locale);
  return (
    <article className="premium-product-card" data-product-id={product.id}>
      <button
        className="product-open"
        onClick={onOpen}
        type="button"
        aria-label={`${copy.details}: ${localized(product.name, locale)}`}
      >
        <ProductVisual product={product} />
      </button>
      <button
        className={`heart-button${favorite ? " active" : ""}`}
        aria-label={copy.favorites}
        aria-pressed={favorite}
        onClick={onFavorite}
        type="button"
      >
        <Icon name="heart" size={23} />
      </button>
      {product.badge ? (
        <span className="product-badge">
          {localized(product.badge, locale)}
        </span>
      ) : null}
      <button className="product-copy" onClick={onOpen} type="button">
        <strong>{localized(product.name, locale)}</strong>
        <small>{localized(product.description, locale)}</small>
      </button>
      <div className="rating-row">
        <span>★ {product.rating.toFixed(1)}</span>
        <small>({product.reviews})</small>
      </div>
      <div className="product-price">
        <div>
          <strong>
            {money(product.priceMinor, locale)} {copy.sum}
          </strong>
          {product.oldPriceMinor ? (
            <del>
              {money(product.oldPriceMinor, locale)} {copy.sum}
            </del>
          ) : null}
        </div>
        <button
          onClick={onAdd}
          type="button"
          aria-label={`${copy.add}: ${localized(product.name, locale)}`}
        >
          <Icon name="cart" size={20} />
        </button>
      </div>
    </article>
  );
}

function ServiceCard({
  service,
  locale,
  onOpen,
}: {
  service: PremiumService;
  locale: CustomerLocale;
  onOpen: () => void;
}) {
  const t = serviceText[locale];
  return (
    <article
      className="service-card"
      style={{ "--service-accent": service.accent } as React.CSSProperties}
      data-service-id={service.id}
    >
      <div className="service-card-icon">
        <Icon name={service.icon} size={56} />
      </div>
      <div className="service-card-copy">
        <span>{textFor(service.turnaround, locale)}</span>
        <h3>{textFor(service.title, locale)}</h3>
        <p>{textFor(service.subtitle, locale)}</p>
        <strong>
          {t.from} {money(service.basePrice, locale)}{" "}
          {getPremiumCopy(locale).sum}
        </strong>
      </div>
      <button onClick={onOpen} type="button">
        {t.start}
        <span>→</span>
      </button>
    </article>
  );
}

function ServiceWizard({
  service,
  locale,
  onClose,
  onNotify,
}: {
  service: PremiumService;
  locale: CustomerLocale;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const t = serviceText[locale];
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<ServiceValues>(() =>
    Object.fromEntries(
      service.fields.map((field) => [
        field.id,
        field.type === "number"
          ? String(field.min ?? 1)
          : (field.options?.[0]?.value ?? ""),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const estimate = useMemo(() => {
    let multiplier = 1;
    for (const field of service.fields) {
      const option = field.options?.find(
        (item) => item.value === values[field.id],
      );
      if (option?.multiplier) multiplier *= option.multiplier;
    }
    const quantity = service.fields
      .filter((field) => field.type === "number")
      .reduce(
        (total, field) => total * Math.max(1, Number(values[field.id]) || 1),
        1,
      );
    return Math.round(service.basePrice * multiplier * Math.min(quantity, 20));
  }, [service, values]);
  const visibleFields =
    step === 1
      ? service.fields.filter(
          (field) => field.type !== "file" && field.type !== "text",
        )
      : service.fields.filter(
          (field) => field.type === "file" || field.type === "text",
        );
  const validate = () => {
    const invalid = visibleFields.some(
      (field) => field.required && !values[field.id]?.trim(),
    );
    if (invalid) {
      setError(t.required);
      return false;
    }
    setError("");
    return true;
  };
  const advance = () => {
    if (validate()) setStep((current) => Math.min(3, current + 1));
  };
  const confirm = () => {
    window.localStorage.setItem(
      SERVICE_KEY,
      JSON.stringify({
        serviceId: service.id,
        values,
        estimate,
        createdAt: new Date().toISOString(),
        demo: true,
      }),
    );
    setStep(4);
    onNotify(t.success);
  };
  return (
    <div
      className="premium-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="service-wizard"
        role="dialog"
        aria-modal="true"
        aria-label={textFor(service.title, locale)}
      >
        <button
          className="modal-close"
          onClick={onClose}
          type="button"
          aria-label={getPremiumCopy(locale).close}
        >
          ×
        </button>
        <header>
          <div
            className="service-card-icon"
            style={
              { "--service-accent": service.accent } as React.CSSProperties
            }
          >
            <Icon name={service.icon} size={48} />
          </div>
          <div>
            <span>
              {t.step} {Math.min(step, 3)} / 3
            </span>
            <h2>{textFor(service.title, locale)}</h2>
          </div>
        </header>
        {step < 4 ? (
          <div className="wizard-progress" aria-label={`${t.step} ${step}`}>
            <i className={step >= 1 ? "active" : ""} />
            <i className={step >= 2 ? "active" : ""} />
            <i className={step >= 3 ? "active" : ""} />
          </div>
        ) : null}
        {step <= 2 ? (
          <div className="wizard-fields">
            <h3>{step === 1 ? t.details : t.files}</h3>
            {visibleFields.map((field) => (
              <label
                key={field.id}
                className={
                  field.type === "file" ? "file-field" : "wizard-field"
                }
              >
                <span>
                  {textFor(field.label, locale)}
                  {field.required ? " *" : ""}
                </span>
                {field.type === "select" ? (
                  <select
                    value={values[field.id]}
                    onChange={(event) =>
                      setValues({ ...values, [field.id]: event.target.value })
                    }
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {textFor(option.label, locale)}
                      </option>
                    ))}
                  </select>
                ) : null}
                {field.type === "number" ? (
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={values[field.id]}
                    onChange={(event) =>
                      setValues({ ...values, [field.id]: event.target.value })
                    }
                  />
                ) : null}
                {field.type === "text" ? (
                  <textarea
                    rows={4}
                    value={values[field.id]}
                    onChange={(event) =>
                      setValues({ ...values, [field.id]: event.target.value })
                    }
                  />
                ) : null}
                {field.type === "file" ? (
                  <>
                    <input
                      type="file"
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [field.id]: event.target.files?.[0]?.name ?? "",
                        })
                      }
                    />
                    <span className="file-button">
                      <Icon name="upload" size={24} />
                      {values[field.id] || t.chooseFile}
                    </span>
                  </>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="wizard-review">
            <span>
              <Icon name="check" size={34} />
            </span>
            <h3>{t.review}</h3>
            <dl>
              {service.fields.map((field) => (
                <div key={field.id}>
                  <dt>{textFor(field.label, locale)}</dt>
                  <dd>
                    {field.options?.find(
                      (option) => option.value === values[field.id],
                    )
                      ? textFor(
                          field.options.find(
                            (option) => option.value === values[field.id],
                          )!.label,
                          locale,
                        )
                      : values[field.id]}
                  </dd>
                </div>
              ))}
            </dl>
            <p>{t.disclaimer}</p>
          </div>
        ) : null}
        {step === 4 ? (
          <div className="wizard-success">
            <span>
              <Icon name="check" size={52} />
            </span>
            <h3>{t.success}</h3>
            <p>{t.successText}</p>
            <button onClick={onClose} type="button">
              {t.done}
            </button>
          </div>
        ) : null}
        {step < 4 ? (
          <footer>
            <div>
              <small>{t.estimate}</small>
              <strong>
                {money(estimate, locale)} {getPremiumCopy(locale).sum}
              </strong>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <nav>
              {step > 1 ? (
                <button
                  className="secondary"
                  onClick={() => setStep((current) => current - 1)}
                  type="button"
                >
                  ← {t.back}
                </button>
              ) : null}
              <button onClick={step === 3 ? confirm : advance} type="button">
                {step === 3 ? t.confirm : t.next} →
              </button>
            </nav>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

export function PremiumApp() {
  const initialLocale = localeFrom(
    new URLSearchParams(window.location.search).get("lang"),
  );
  const [locale, setLocale] = useState<CustomerLocale>(initialLocale);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PremiumCategory | "all">(
    "all",
  );
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [feedSize, setFeedSize] = useState(42);
  const [cart, setCart] = useState<Cart>(() => readJson<Cart>(CART_KEY, {}));
  const [favorites, setFavorites] = useState<string[]>(() =>
    readJson<string[]>(FAVORITES_KEY, []),
  );
  const [selected, setSelected] = useState<PremiumProduct | null>(null);
  const [service, setService] = useState<PremiumService | null>(null);
  const [selectedOption, setSelectedOption] = useState("Standard");
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const copy = getPremiumCopy(locale);
  const catalog = useMemo(
    () => createProductFeed(Math.max(feedSize * 3, 500)),
    [feedSize],
  );
  const products = catalog
    .filter((item) =>
      ["stationery", "gifts", "accessories"].includes(item.category),
    )
    .slice(0, feedSize);
  useEffect(() => {
    document.documentElement.lang = locale;
    const params = new URLSearchParams(window.location.search);
    params.set("lang", locale);
    window.history.replaceState(
      window.history.state,
      "",
      `/premium?${params.toString()}${window.location.hash}`,
    );
  }, [locale]);
  useEffect(
    () => window.localStorage.setItem(CART_KEY, JSON.stringify(cart)),
    [cart],
  );
  useEffect(
    () => window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)),
    [favorites],
  );
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setFeedSize((value) => value + 24);
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const restoreScroll = useCallback(() => {
    const saved = Number(window.sessionStorage.getItem(SCROLL_KEY) ?? "0");
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: saved, behavior: "auto" }),
    );
  }, []);
  useEffect(() => {
    const onPopState = () => {
      if (!window.location.hash.startsWith("#product=")) {
        setSelected(null);
        restoreScroll();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restoreScroll]);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };
  const openProduct = (product: PremiumProduct) => {
    window.sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    setSelectedOption("Standard");
    setSelected(product);
    window.history.pushState(
      { productId: product.id },
      "",
      `#product=${product.id}`,
    );
  };
  const closeProduct = () => {
    if (window.location.hash.startsWith("#product=")) window.history.back();
    else {
      setSelected(null);
      restoreScroll();
    }
  };
  const addProduct = (product: PremiumProduct) => {
    setCart((value) => ({
      ...value,
      [product.id]: (value[product.id] ?? 0) + 1,
    }));
    notify(copy.added);
  };
  const changeQuantity = (id: string, delta: number) =>
    setCart((value) => {
      const quantity = Math.max(0, (value[id] ?? 0) + delta);
      const next = { ...value };
      if (!quantity) delete next[id];
      else next[id] = quantity;
      return next;
    });
  const toggleFavorite = (product: PremiumProduct) => {
    const exists = favorites.includes(product.id);
    setFavorites((value) =>
      exists ? value.filter((id) => id !== product.id) : [...value, product.id],
    );
    notify(exists ? copy.favoriteRemoved : copy.favoriteAdded);
  };
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const selectCategory = (category: PremiumCategory | "all") => {
    const relatedService = premiumServices.find((item) => item.id === category);
    if (relatedService) {
      setService(relatedService);
      return;
    }
    setFavoritesOnly(false);
    setActiveCategory(category);
    scrollTo("premium-catalog");
  };
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleProducts = products.filter(
    (product) =>
      (activeCategory === "all" || product.category === activeCategory) &&
      (!favoritesOnly || favorites.includes(product.id)) &&
      (!normalizedQuery ||
        `${localized(product.name, locale)} ${localized(product.description, locale)}`
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery)),
  );
  const cartItems = Object.entries(cart)
    .map(([id, quantity]) => ({
      product: catalog.find((item) => item.id === id),
      quantity,
    }))
    .filter((item): item is { product: PremiumProduct; quantity: number } =>
      Boolean(item.product),
    );
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce(
    (sum, item) => sum + item.product.priceMinor * item.quantity,
    0,
  );
  const benefitItems: Array<[string, string, string]> = [
    ["truck", copy.fast, copy.fastText],
    ["shield", copy.quality, copy.qualityText],
    ["tag", copy.useful, copy.usefulText],
    ["home", copy.near, copy.nearText],
  ];

  return (
    <div className="premium-root">
      <div className="premium-demo-bar">{copy.demo}</div>
      <header className="premium-header">
        <button
          className="logo-button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          type="button"
        >
          <Logo />
        </button>
        <button
          className="location-button"
          onClick={() => notify(copy.demoSection)}
          type="button"
        >
          <span className="location-pin">●</span>
          <span>{copy.location}</span>
          <b>⌄</b>
        </button>
        <label className="premium-search">
          <Icon name="search" size={21} />
          <input
            aria-label={copy.search}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            value={query}
          />
          {query ? (
            <button
              aria-label={copy.close}
              onClick={() => setQuery("")}
              type="button"
            >
              ×
            </button>
          ) : null}
        </label>
        <nav className="premium-actions" aria-label={copy.account}>
          <button
            onClick={() => {
              setActiveCategory("all");
              setQuery("");
              setFavoritesOnly(true);
              scrollTo("premium-catalog");
            }}
            type="button"
          >
            <Icon name="heart" />
            <small>{copy.favorites}</small>
            <b>{favorites.length}</b>
          </button>
          <button onClick={() => setCartOpen(true)} type="button">
            <Icon name="cart" />
            <small>{copy.cart}</small>
            <b>{cartCount}</b>
          </button>
          <button
            className="account-action"
            onClick={() => notify(copy.demoSection)}
            type="button"
          >
            <Icon name="user" />
            <small>{copy.account}</small>
          </button>
        </nav>
        <div className="premium-locales" aria-label="Til / Язык / Language">
          {(["uz", "ru", "en"] as CustomerLocale[]).map((code) => (
            <button
              aria-pressed={locale === code}
              key={code}
              onClick={() => setLocale(code)}
              type="button"
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <div className="premium-layout">
        <aside className="premium-sidebar">
          <nav>
            <button
              className="active"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              type="button"
            >
              <Icon name="home" />
              {copy.home}
            </button>
            <button onClick={() => scrollTo("premium-services")} type="button">
              <Icon name="printer" />
              {copy.services}
            </button>
            <button onClick={() => scrollTo("premium-catalog")} type="button">
              <Icon name="stationery" />
              {copy.products}
            </button>
            <button onClick={() => selectCategory("gifts")} type="button">
              <Icon name="gift" />
              {copy.gifts}
            </button>
            <button onClick={() => selectCategory("design")} type="button">
              <Icon name="pen" />
              {copy.design}
            </button>
            <button
              onClick={() => scrollTo("premium-promotions")}
              type="button"
            >
              <Icon name="tag" />
              {copy.promotions}
            </button>
          </nav>
          <div className="app-promo">
            <div className="app-promo-mark">A</div>
            <strong>AGAT Premium</strong>
            <span>Web prototype</span>
            <small>UZ · RU · EN</small>
          </div>
        </aside>
        <main className="premium-main">
          <section className="premium-hero">
            <div className="premium-hero-copy">
              <span>{copy.heroEyebrow}</span>
              <h1>{copy.heroTitle}</h1>
              <p>{copy.heroText}</p>
              <button
                onClick={() => scrollTo("premium-services")}
                type="button"
              >
                {copy.order} <span>→</span>
              </button>
            </div>
            <div className="premium-hero-art" aria-hidden="true">
              <div className="hero-glow" />
              <div className="hero-letter">A</div>
              <div className="hero-sheet">
                <Icon name="photo" size={72} />
                <b>AGAT</b>
              </div>
              <div className="hero-printer">
                <Icon name="printer" size={108} />
              </div>
              <div className="hero-cup">A</div>
            </div>
          </section>
          <section className="premium-benefits">
            {benefitItems.map(([icon, title, text]) => (
              <article key={title}>
                <span>
                  <Icon name={icon} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </div>
              </article>
            ))}
          </section>
          <section
            id="premium-services"
            className="premium-section services-section"
          >
            <div className="premium-section-heading">
              <div>
                <span>AGAT SERVICES</span>
                <h2>{copy.popular}</h2>
                <p>{serviceText[locale].serviceNotCart}</p>
              </div>
            </div>
            <div className="service-grid">
              {premiumServices.map((item) => (
                <ServiceCard
                  key={item.id}
                  service={item}
                  locale={locale}
                  onOpen={() => setService(item)}
                />
              ))}
            </div>
          </section>
          <section className="premium-promo-row" id="premium-promotions">
            <article className="discount-card">
              <div>
                <span>{copy.discount}</span>
                <strong>{copy.discountText}</strong>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText("AGAT20");
                    notify(copy.copied);
                  }}
                  type="button"
                >
                  {copy.copyPromo}
                </button>
              </div>
              <span className="promo-gift">
                <Icon name="gift" size={72} />
              </span>
            </article>
            <article className="souvenir-card">
              <div>
                <span>PERSONAL PRINT</span>
                <strong>{copy.giftIdeas}</strong>
                <button onClick={() => selectCategory("gifts")} type="button">
                  {copy.all} →
                </button>
              </div>
              <div className="souvenir-mock">
                <Icon name="photo" size={62} />
              </div>
            </article>
          </section>
          <section className="premium-section product-categories">
            <div className="premium-section-heading">
              <div>
                <span>AGAT MARKET</span>
                <h2>{copy.categories}</h2>
              </div>
              <button onClick={() => selectCategory("all")} type="button">
                {copy.all} →
              </button>
            </div>
            <div className="premium-category-grid">
              {categories
                .filter((item) =>
                  ["stationery", "gifts", "accessories"].includes(item.id),
                )
                .map((category) => (
                  <button
                    aria-pressed={activeCategory === category.id}
                    key={category.id}
                    onClick={() => selectCategory(category.id)}
                    type="button"
                  >
                    <span>
                      <Icon
                        name={category.id === "gifts" ? "gift" : category.id}
                        size={42}
                      />
                    </span>
                    <strong>{localized(category.label, locale)}</strong>
                    <small>{copy.synthetic}</small>
                  </button>
                ))}
            </div>
          </section>
          <section className="weekly-banner">
            <div>
              <span>{copy.weekly}</span>
              <strong>−50%</strong>
              <p>{copy.discountText}</p>
              <button onClick={() => scrollTo("premium-catalog")} type="button">
                {copy.all} →
              </button>
            </div>
            <div className="weekly-products">
              <span>
                <Icon name="stationery" size={64} />
              </span>
              <span>
                <Icon name="accessories" size={74} />
              </span>
              <span>
                <Icon name="gift" size={68} />
              </span>
            </div>
          </section>
          <section className="premium-section" id="premium-catalog">
            <div className="premium-section-heading">
              <div>
                <span>CURATED FOR YOU</span>
                <h2>
                  {favoritesOnly
                    ? copy.favorites
                    : query
                      ? `${copy.products}: “${query}”`
                      : activeCategory === "all"
                        ? copy.recommendations
                        : localized(
                            categories.find(
                              (item) => item.id === activeCategory,
                            )!.label,
                            locale,
                          )}
                </h2>
              </div>
              <button
                onClick={() => {
                  setQuery("");
                  setFavoritesOnly(false);
                  setActiveCategory("all");
                }}
                type="button"
              >
                {copy.all} →
              </button>
            </div>
            {visibleProducts.length ? (
              <div className="premium-products-grid">
                {visibleProducts.map((product) => (
                  <ProductCard
                    favorite={favorites.includes(product.id)}
                    key={product.id}
                    locale={locale}
                    onAdd={() => addProduct(product)}
                    onFavorite={() => toggleFavorite(product)}
                    onOpen={() => openProduct(product)}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="premium-empty">
                <Icon name="search" size={46} />
                <strong>{copy.searchEmpty}</strong>
              </div>
            )}
            <div className="feed-sentinel" ref={loadMoreRef}>
              <span className="spinner" />
              {copy.loading}
            </div>
          </section>
        </main>
      </div>
      <nav className="premium-mobile-nav">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          type="button"
        >
          <Icon name="home" />
          <span>{copy.navHome}</span>
        </button>
        <button onClick={() => scrollTo("premium-services")} type="button">
          <Icon name="printer" />
          <span>{copy.services}</span>
        </button>
        <button onClick={() => scrollTo("premium-catalog")} type="button">
          <Icon name="stationery" />
          <span>{copy.navCatalog}</span>
        </button>
        <button onClick={() => setCartOpen(true)} type="button">
          <Icon name="cart" />
          <span>{copy.cart}</span>
          <b>{cartCount}</b>
        </button>
        <button onClick={() => notify(copy.demoSection)} type="button">
          <Icon name="user" />
          <span>{copy.navProfile}</span>
        </button>
      </nav>
      {selected ? (
        <div
          className="premium-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProduct();
          }}
        >
          <section
            className="premium-product-modal"
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              onClick={closeProduct}
              type="button"
              aria-label={copy.close}
            >
              ×
            </button>
            <ProductVisual product={selected} large />
            <div className="modal-product-copy">
              <span>{copy.synthetic}</span>
              <h2>{localized(selected.name, locale)}</h2>
              <div className="rating-row">
                <span>★ {selected.rating.toFixed(1)}</span>
                <small>({selected.reviews})</small>
              </div>
              <p>{localized(selected.description, locale)}</p>
              <strong>
                {money(selected.priceMinor, locale)} {copy.sum}
              </strong>
              <small>{copy.choose}</small>
              <div className="option-row">
                {["Standard", "Premium", "Gift"].map((option) => (
                  <button
                    aria-pressed={selectedOption === option}
                    key={option}
                    onClick={() => setSelectedOption(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                className="primary-wide"
                onClick={() => addProduct(selected)}
                type="button"
              >
                <Icon name="cart" size={22} />
                {copy.add}
              </button>
              <em>{copy.demoNotice}</em>
            </div>
          </section>
        </div>
      ) : null}
      {service ? (
        <ServiceWizard
          service={service}
          locale={locale}
          onClose={() => setService(null)}
          onNotify={notify}
        />
      ) : null}
      {cartOpen ? (
        <div
          className="premium-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCartOpen(false);
          }}
        >
          <aside
            className="premium-cart-drawer"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <div>
                <span>{copy.synthetic}</span>
                <h2>{copy.cartTitle}</h2>
              </div>
              <button
                aria-label={copy.close}
                onClick={() => setCartOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            {cartItems.length ? (
              <>
                <div className="cart-list">
                  {cartItems.map(({ product, quantity }) => (
                    <article key={product.id}>
                      <ProductVisual product={product} />
                      <div>
                        <strong>{localized(product.name, locale)}</strong>
                        <small>
                          {money(product.priceMinor, locale)} {copy.sum}
                        </small>
                        <div className="quantity-control">
                          <button
                            onClick={() => changeQuantity(product.id, -1)}
                            type="button"
                          >
                            −
                          </button>
                          <span>{quantity}</span>
                          <button
                            onClick={() => changeQuantity(product.id, 1)}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <button
                        className="remove-cart"
                        onClick={() => changeQuantity(product.id, -quantity)}
                        type="button"
                        aria-label={copy.remove}
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
                <footer>
                  <div>
                    <span>{copy.subtotal}</span>
                    <strong>
                      {money(cartTotal, locale)} {copy.sum}
                    </strong>
                  </div>
                  <button
                    onClick={() => notify(copy.checkoutNotice)}
                    type="button"
                  >
                    {copy.checkout}
                  </button>
                  <small>{copy.demoNotice}</small>
                </footer>
              </>
            ) : (
              <div className="cart-empty">
                <Icon name="cart" size={60} />
                <strong>{copy.cartEmpty}</strong>
                <p>{copy.cartEmptyText}</p>
                <button onClick={() => setCartOpen(false)} type="button">
                  {copy.continueShopping}
                </button>
              </div>
            )}
          </aside>
        </div>
      ) : null}
      {toast ? (
        <div className="premium-toast" role="status">
          <Icon name="check" size={20} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
