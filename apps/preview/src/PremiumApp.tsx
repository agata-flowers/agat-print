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
import "./premium.css";

type Cart = Record<string, number>;

const CART_KEY = "agat-premium-demo-cart";
const FAVORITES_KEY = "agat-premium-demo-favorites";
const SCROLL_KEY = "agat-premium-demo-scroll";

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
  return (
    <div
      className={`premium-product-visual tone-${product.tone}${large ? " large" : ""}`}
    >
      <span className="visual-orbit" />
      <span className="visual-object">{product.icon}</span>
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
        {favorite ? "♥" : "♡"}
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
          ＋
        </button>
      </div>
    </article>
  );
}

function SectionHeading({
  title,
  action,
  onAction,
}: {
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="premium-section-heading">
      <h2>{title}</h2>
      <button onClick={onAction} type="button">
        {action} <span>→</span>
      </button>
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
  const [selectedOption, setSelectedOption] = useState("Standard");
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const copy = getPremiumCopy(locale);
  const catalog = useMemo(
    () => createProductFeed(Math.max(feedSize, 500)),
    [feedSize],
  );
  const products = catalog.slice(0, feedSize);

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
        if (entry?.isIntersecting) setFeedSize((value) => value + 18);
      },
      { rootMargin: "500px" },
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
    window.setTimeout(() => setToast(""), 2_200);
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

  const changeQuantity = (id: string, delta: number) => {
    setCart((value) => {
      const quantity = Math.max(0, (value[id] ?? 0) + delta);
      const next = { ...value };
      if (quantity === 0) delete next[id];
      else next[id] = quantity;
      return next;
    });
  };

  const toggleFavorite = (product: PremiumProduct) => {
    const exists = favorites.includes(product.id);
    setFavorites((value) =>
      exists ? value.filter((id) => id !== product.id) : [...value, product.id],
    );
    notify(exists ? copy.favoriteRemoved : copy.favoriteAdded);
  };

  const selectCategory = (category: PremiumCategory | "all") => {
    setFavoritesOnly(false);
    setActiveCategory(category);
    document
      .getElementById("premium-catalog")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleProducts = products.filter((product) => {
    const categoryMatches =
      activeCategory === "all" || product.category === activeCategory;
    const favoriteMatches = !favoritesOnly || favorites.includes(product.id);
    const searchMatches =
      !normalizedQuery ||
      `${localized(product.name, locale)} ${localized(product.description, locale)}`
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    return categoryMatches && favoriteMatches && searchMatches;
  });

  const cartItems = Object.entries(cart)
    .map(([id, quantity]) => ({
      product: catalog.find((product) => product.id === id),
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
  const featured = products.slice(0, 6);

  const sideNavigation: Array<[string, string, () => void]> = [
    ["⌂", copy.home, () => window.scrollTo({ top: 0, behavior: "smooth" })],
    ["▣", copy.services, () => scrollTo("premium-services")],
    ["▦", copy.products, () => scrollTo("premium-catalog")],
    ["◇", copy.gifts, () => selectCategory("gifts")],
    ["✦", copy.design, () => selectCategory("design")],
    ["%", copy.promotions, () => scrollTo("premium-promotions")],
    ["⌖", copy.studios, () => notify(copy.demoSection)],
    ["♧", copy.partner, () => notify(copy.demoSection)],
  ];
  const mobileNavigation: Array<[string, string, () => void]> = [
    ["⌂", copy.navHome, () => window.scrollTo({ top: 0, behavior: "smooth" })],
    ["▦", copy.navCatalog, () => scrollTo("premium-catalog")],
    ["▤", copy.navOrders, () => notify(copy.demoSection)],
    [
      "♡",
      copy.favorites,
      () => {
        setActiveCategory("all");
        setQuery("");
        setFavoritesOnly(true);
        scrollTo("premium-catalog");
      },
    ],
    ["◉", copy.navProfile, () => notify(copy.demoSection)],
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
          ⌖ <span>{copy.location}</span>⌄
        </button>
        <label className="premium-search">
          <span>⌕</span>
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
            <span>♡</span>
            <small>{copy.favorites}</small>
            <b>{favorites.length}</b>
          </button>
          <button onClick={() => setCartOpen(true)} type="button">
            <span>♧</span>
            <small>{copy.cart}</small>
            <b>{cartCount}</b>
          </button>
          <button onClick={() => notify(copy.notifications)} type="button">
            <span>♢</span>
            <small>{copy.notifications}</small>
          </button>
          <button
            className="account-action"
            onClick={() => notify(copy.demoSection)}
            type="button"
          >
            <span>◉</span>
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
            {sideNavigation.map(([icon, label, action], index) => (
              <button
                className={index === 0 ? "active" : ""}
                key={label}
                onClick={action}
                type="button"
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="app-promo">
            <strong>AGAT</strong>
            <span>Premium prototype</span>
            <div className="qr-demo">▦</div>
            <small>Web · Android · iOS</small>
          </div>
        </aside>

        <main className="premium-main">
          <section className="premium-hero" id="premium-home">
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
              <span className="hero-a">A</span>
              <span className="hero-printer">
                ▤<i>AGAT PRINT</i>
              </span>
              <span className="hero-shirt">A</span>
              <span className="hero-mug">A</span>
              <span className="hero-leaf">✦</span>
            </div>
          </section>

          <section className="premium-benefits" aria-label={copy.quality}>
            {[
              ["⚡", copy.fast, copy.fastText],
              ["♢", copy.quality, copy.qualityText],
              ["◇", copy.useful, copy.usefulText],
              ["⌖", copy.near, copy.nearText],
              ["▰", copy.delivery, copy.deliveryText],
            ].map(([icon, title, text]) => (
              <button
                key={title}
                onClick={() => notify(copy.demoSection)}
                type="button"
              >
                <span>{icon}</span>
                <strong>{title}</strong>
                <small>{text}</small>
              </button>
            ))}
          </section>

          <section id="premium-services" className="premium-section">
            <SectionHeading
              title={copy.popular}
              action={copy.all}
              onAction={() => selectCategory("all")}
            />
            <div className="premium-category-grid">
              {categories.slice(0, 6).map((category) => (
                <button
                  key={category.id}
                  onClick={() => selectCategory(category.id)}
                  type="button"
                >
                  <span>{category.icon}</span>
                  <strong>{localized(category.label, locale)}</strong>
                </button>
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
              <span className="gift-box">✦</span>
            </article>
            <article className="souvenir-card">
              <div>
                <span>AGAT PRINT</span>
                <strong>{copy.giftIdeas}</strong>
                <button onClick={() => selectCategory("gifts")} type="button">
                  {copy.all} →
                </button>
              </div>
              <div className="souvenir-mock">A</div>
            </article>
          </section>

          <section className="premium-section">
            <SectionHeading
              title={copy.categories}
              action={copy.all}
              onAction={() => selectCategory("all")}
            />
            <div className="premium-category-grid compact">
              {categories.map((category) => (
                <button
                  aria-pressed={activeCategory === category.id}
                  key={category.id}
                  onClick={() => selectCategory(category.id)}
                  type="button"
                >
                  <span>{category.icon}</span>
                  <strong>{localized(category.label, locale)}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="weekly-banner">
            <div>
              <span>{copy.weekly}</span>
              <strong>−50%</strong>
              <button onClick={() => scrollTo("premium-catalog")} type="button">
                {copy.all} →
              </button>
            </div>
            <div className="weekly-products">
              <span>▤</span>
              <span>◉</span>
              <span>✎</span>
            </div>
          </section>

          <section className="premium-section" id="premium-catalog">
            <SectionHeading
              title={
                favoritesOnly
                  ? copy.favorites
                  : query
                    ? `${copy.products}: “${query}”`
                    : activeCategory === "all"
                      ? copy.recommendations
                      : localized(
                          categories.find((item) => item.id === activeCategory)!
                            .label,
                          locale,
                        )
              }
              action={copy.all}
              onAction={() => {
                setQuery("");
                setFavoritesOnly(false);
                setActiveCategory("all");
              }}
            />
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
                <span>⌕</span>
                <strong>{copy.searchEmpty}</strong>
              </div>
            )}
            <div className="feed-sentinel" ref={loadMoreRef}>
              <span className="spinner" />
              {copy.loading}
            </div>
          </section>

          <section className="large-format-banner">
            <div>
              <strong>{localized(categories[2]!.label, locale)}</strong>
              <span>{localized(featured[1]!.description, locale)}</span>
              <button onClick={() => selectCategory("outdoor")} type="button">
                {copy.order} →
              </button>
            </div>
            <span className="format-visual">XL</span>
          </section>
        </main>
      </div>

      <nav className="premium-mobile-nav" aria-label={copy.home}>
        {mobileNavigation.map(([icon, label, action], index) => (
          <button
            className={index === 0 ? "active" : ""}
            key={label}
            onClick={action}
            type="button"
          >
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>

      {selected ? (
        <div
          className="premium-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeProduct();
          }}
        >
          <section
            aria-label={localized(selected.name, locale)}
            aria-modal="true"
            className="premium-product-modal"
            role="dialog"
          >
            <button
              aria-label={copy.close}
              className="modal-close"
              onClick={closeProduct}
              type="button"
            >
              ×
            </button>
            <ProductVisual large product={selected} />
            <div className="modal-copy">
              <span className="demo-pill">{copy.synthetic}</span>
              <h2>{localized(selected.name, locale)}</h2>
              <p>{localized(selected.description, locale)}</p>
              <div className="rating-row">
                <span>★ {selected.rating.toFixed(1)}</span>
                <small>({selected.reviews})</small>
              </div>
              <h3>
                {money(selected.priceMinor, locale)} {copy.sum}
              </h3>
              <strong>{copy.choose}</strong>
              <div className="option-pills">
                {["Standard", "Premium", "Express"].map((option) => (
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
              <div className="modal-actions">
                <button
                  className="secondary"
                  onClick={() => toggleFavorite(selected)}
                  type="button"
                >
                  {favorites.includes(selected.id) ? "♥" : "♡"}{" "}
                  {copy.favorites}
                </button>
                <button onClick={() => addProduct(selected)} type="button">
                  ＋ {copy.add}
                </button>
              </div>
              <small className="demo-warning">{copy.demoNotice}</small>
            </div>
          </section>
        </div>
      ) : null}

      <aside
        aria-hidden={!cartOpen}
        className={`premium-cart-drawer${cartOpen ? " open" : ""}`}
      >
        <div className="cart-drawer-head">
          <h2>{copy.cartTitle}</h2>
          <button
            aria-label={copy.close}
            onClick={() => setCartOpen(false)}
            type="button"
          >
            ×
          </button>
        </div>
        {cartItems.length ? (
          <div className="cart-drawer-items">
            {cartItems.map(({ product, quantity }) => (
              <article key={product.id}>
                <ProductVisual product={product} />
                <div>
                  <strong>{localized(product.name, locale)}</strong>
                  <small>
                    {money(product.priceMinor, locale)} {copy.sum}
                  </small>
                  <div className="quantity-control" aria-label={copy.quantity}>
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
                      ＋
                    </button>
                  </div>
                  <button
                    className="remove-link"
                    onClick={() => changeQuantity(product.id, -quantity)}
                    type="button"
                  >
                    {copy.remove}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="cart-empty">
            <span>♧</span>
            <strong>{copy.cartEmpty}</strong>
            <p>{copy.cartEmptyText}</p>
          </div>
        )}
        <div className="cart-drawer-footer">
          <div>
            <span>{copy.subtotal}</span>
            <strong>
              {money(cartTotal, locale)} {copy.sum}
            </strong>
          </div>
          <button
            disabled={!cartItems.length}
            onClick={() => notify(copy.checkoutNotice)}
            type="button"
          >
            {copy.checkout}
          </button>
          <small>{copy.demoNotice}</small>
        </div>
      </aside>
      {cartOpen ? (
        <button
          aria-label={copy.close}
          className="drawer-scrim"
          onClick={() => setCartOpen(false)}
          type="button"
        />
      ) : null}
      {toast ? (
        <div aria-live="polite" className="premium-toast">
          ✓ {toast}
        </div>
      ) : null}
    </div>
  );
}
