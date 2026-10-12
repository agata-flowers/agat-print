import { useEffect, useMemo, useState } from "react";
import {
  getPreviewCopy,
  localeLabels,
  SUPPORTED_LOCALES,
  type CustomerLocale,
} from "@agat/i18n";
import { AGAT_BRAND } from "@agat/ui";
import {
  CUSTOMER_STEPS,
  readPreviewState,
  writePreviewState,
  type CustomerStep,
  type PreviewState,
  type PreviewSurface,
} from "./preview-state";

type Copy = ReturnType<typeof getPreviewCopy>;

const stepLabels = (copy: Copy): Record<CustomerStep, string> => ({
  home: copy.stepHome,
  service: copy.stepService,
  upload: copy.stepUpload,
  settings: copy.stepSettings,
  preview: copy.stepPreview,
  basket: copy.stepBasket,
  checkout: copy.stepCheckout,
  status: copy.stepStatus,
});

const ServiceIcon = ({ kind }: { kind: "document" | "photo" | "id" }) => (
  <span className={`service-icon service-icon-${kind}`} aria-hidden="true">
    {kind === "document" ? "Aa" : kind === "photo" ? "◫" : "◎"}
  </span>
);

function ServiceGrid({ copy }: { copy: Copy }) {
  const services = [
    {
      kind: "document" as const,
      title: copy.documentPrint,
      description: copy.documentPrintText,
      price: "1 200 UZS",
    },
    {
      kind: "photo" as const,
      title: copy.photoPrint,
      description: copy.photoPrintText,
      price: "2 500 UZS",
    },
    {
      kind: "id" as const,
      title: copy.idPhoto,
      description: copy.idPhotoText,
      price: "25 000 UZS",
    },
  ];
  return (
    <div className="service-grid" aria-label={copy.popular}>
      {services.map((service, index) => (
        <article
          className={`service-card tone-${index + 1}`}
          key={service.kind}
        >
          <ServiceIcon kind={service.kind} />
          <div>
            <h3>{service.title}</h3>
            <p>{service.description}</p>
          </div>
          <strong>
            {copy.fromPrice} {service.price}
          </strong>
        </article>
      ))}
    </div>
  );
}

function HomeScreen({ copy, onStart }: { copy: Copy; onStart: () => void }) {
  return (
    <div className="home-screen">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroText}</p>
          <button className="primary-action" onClick={onStart} type="button">
            {copy.openOrder}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="paper-stack paper-back" />
          <div className="paper-stack paper-front">
            <span>AGAT</span>
            <div />
            <div />
            <small>PRINT</small>
          </div>
          <div className="hero-seal">A</div>
        </div>
      </section>
      <div className="trust-row">
        <span>⌁ {copy.heroTrust}</span>
        <span>◇ {copy.heroPrice}</span>
        <span>↻ {copy.heroResume}</span>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{copy.allServices}</span>
          <h2>{copy.popular}</h2>
        </div>
        <button className="text-action" onClick={onStart} type="button">
          {copy.allServices} <span aria-hidden="true">→</span>
        </button>
      </div>
      <ServiceGrid copy={copy} />
    </div>
  );
}

function ServiceScreen({ copy }: { copy: Copy }) {
  return (
    <section className="content-card roomy">
      <div className="section-heading compact">
        <div>
          <span className="step-kicker">02</span>
          <h2>{copy.selectService}</h2>
        </div>
        <span className="selection-pill">✓ {copy.selected}</span>
      </div>
      <ServiceGrid copy={copy} />
      <div className="selected-service">
        <ServiceIcon kind="document" />
        <div>
          <strong>{copy.documentPrint}</strong>
          <span>{copy.documentPrintText}</span>
        </div>
        <strong>1 200 UZS</strong>
      </div>
    </section>
  );
}

function UploadScreen({ copy }: { copy: Copy }) {
  return (
    <section className="content-card split-card">
      <div className="content-copy">
        <span className="step-kicker">03</span>
        <h2>{copy.uploadTitle}</h2>
        <p>{copy.uploadText}</p>
        <div className="drop-zone" role="img" aria-label={copy.dropFile}>
          <span className="upload-mark" aria-hidden="true">
            ↑
          </span>
          <strong>{copy.dropFile}</strong>
          <small>{copy.safeFileNote}</small>
        </div>
      </div>
      <aside className="file-summary">
        <span className="file-type">PDF</span>
        <div>
          <strong>{copy.syntheticFile}</strong>
          <small>2.4 MB · 4 {copy.page.toLowerCase()}</small>
        </div>
        <span className="success-dot">✓</span>
        <p>{copy.uploadReady}</p>
      </aside>
    </section>
  );
}

function OptionGroup({ label, values }: { label: string; values: string[] }) {
  const [selected, setSelected] = useState(0);
  return (
    <fieldset className="option-group">
      <legend>{label}</legend>
      <div>
        {values.map((value, index) => (
          <button
            aria-pressed={selected === index}
            className={selected === index ? "selected" : ""}
            key={value}
            onClick={() => setSelected(index)}
            type="button"
          >
            {value}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsScreen({ copy }: { copy: Copy }) {
  return (
    <section className="content-card roomy">
      <span className="step-kicker">04</span>
      <h2>{copy.settingsTitle}</h2>
      <div className="options-grid">
        <OptionGroup label={copy.paperSize} values={["A4", "A3"]} />
        <OptionGroup
          label={copy.colorMode}
          values={[copy.color, copy.monochrome]}
        />
        <OptionGroup
          label={copy.sides}
          values={[copy.oneSided, copy.twoSided]}
        />
        <label className="copies-field">
          {copy.copies}
          <span>
            <button type="button" aria-label="−">
              −
            </button>
            <strong>2</strong>
            <button type="button" aria-label="+">
              +
            </button>
          </span>
        </label>
      </div>
      <div className="price-preview">
        <span>{copy.total}</span>
        <strong>19 200 UZS</strong>
      </div>
    </section>
  );
}

function LayoutScreen({ copy }: { copy: Copy }) {
  return (
    <section className="layout-screen">
      <div className="layout-document" aria-label={copy.previewStep}>
        <div className="layout-toolbar">
          <span>−</span>
          <strong>100%</strong>
          <span>＋</span>
        </div>
        <div className="document-page">
          <small>AGAT PRINT · SYNTHETIC</small>
          <h3>Preview</h3>
          <div className="document-line wide" />
          <div className="document-line" />
          <div className="document-line short" />
          <div className="document-block" />
          <span>{copy.page} 1 / 4</span>
        </div>
      </div>
      <aside className="layout-review">
        <span className="step-kicker">05</span>
        <h2>{copy.previewStep}</h2>
        <p>{copy.previewText}</p>
        <div className="success-callout">✓ {copy.layoutReady}</div>
        <button className="primary-action full" type="button">
          {copy.approveLayout}
        </button>
      </aside>
    </section>
  );
}

function BasketScreen({ copy }: { copy: Copy }) {
  return (
    <section className="content-card roomy">
      <div className="section-heading compact">
        <div>
          <span className="step-kicker">06</span>
          <h2>{copy.basketTitle}</h2>
          <p>{copy.basketText}</p>
        </div>
        <span className="basket-count">2 {copy.item}</span>
      </div>
      <div className="basket-list">
        <div className="basket-item">
          <span className="mini-preview">Aa</span>
          <div>
            <strong>{copy.documentPrint}</strong>
            <small>
              A4 · {copy.color} · 2 × 4 {copy.page.toLowerCase()}
            </small>
          </div>
          <strong>9 600 UZS</strong>
        </div>
        <div className="basket-item">
          <span className="mini-preview photo">◫</span>
          <div>
            <strong>{copy.photoPrint}</strong>
            <small>10×15 · 4 ×</small>
          </div>
          <strong>10 000 UZS</strong>
        </div>
      </div>
      <button className="secondary-action" type="button">
        ＋ {copy.addService}
      </button>
      <div className="basket-total">
        <span>{copy.subtotal}</span>
        <strong>19 600 UZS</strong>
      </div>
    </section>
  );
}

function CheckoutScreen({ copy }: { copy: Copy }) {
  return (
    <section className="checkout-grid">
      <div className="content-card roomy">
        <span className="step-kicker">07</span>
        <h2>{copy.checkoutTitle}</h2>
        <div className="checkout-row">
          <span>{copy.fulfillment}</span>
          <strong>{copy.pickup}</strong>
        </div>
        <div className="checkout-row">
          <span>{copy.studio}</span>
          <strong>{copy.autoStudio}</strong>
        </div>
        <div className="checkout-row">
          <span>{copy.subtotal}</span>
          <strong>19 600 UZS</strong>
        </div>
        <div className="checkout-row">
          <span>{copy.pickup}</span>
          <strong>{copy.free}</strong>
        </div>
      </div>
      <aside className="payment-summary">
        <span>{copy.total}</span>
        <strong>19 600 UZS</strong>
        <button className="primary-action full" type="button">
          {copy.pay}
        </button>
        <p>◇ {copy.securePayment}</p>
      </aside>
    </section>
  );
}

function StatusScreen({ copy }: { copy: Copy }) {
  const timeline = [
    copy.timelineReceived,
    copy.timelinePaid,
    copy.timelineStudio,
    copy.timelineProduction,
    copy.timelineReady,
  ];
  return (
    <section className="status-screen">
      <div className="status-hero">
        <span className="status-check">✓</span>
        <span className="eyebrow">{copy.orderNumber}</span>
        <h2>{copy.statusTitle}</h2>
        <p>{copy.statusText}</p>
        <div>
          <span>{copy.expected}</span>
          <strong>{copy.today}</strong>
        </div>
      </div>
      <div className="timeline-card">
        <strong>{copy.orderStatus}</strong>
        <ol>
          {timeline.map((event, index) => (
            <li className={index < 4 ? "done" : ""} key={event}>
              <span>{index < 4 ? "✓" : index + 1}</span>
              {event}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CustomerScreen({
  copy,
  step,
  setStep,
}: {
  copy: Copy;
  step: CustomerStep;
  setStep: (step: CustomerStep) => void;
}) {
  if (step === "home")
    return <HomeScreen copy={copy} onStart={() => setStep("service")} />;
  if (step === "service") return <ServiceScreen copy={copy} />;
  if (step === "upload") return <UploadScreen copy={copy} />;
  if (step === "settings") return <SettingsScreen copy={copy} />;
  if (step === "preview") return <LayoutScreen copy={copy} />;
  if (step === "basket") return <BasketScreen copy={copy} />;
  if (step === "checkout") return <CheckoutScreen copy={copy} />;
  return <StatusScreen copy={copy} />;
}

function CustomerNavigation({ copy }: { copy: Copy }) {
  return (
    <nav className="customer-nav" aria-label={copy.home}>
      <span className="active">{copy.home}</span>
      <span>{copy.services}</span>
      <span>{copy.orders}</span>
      <span>{copy.support}</span>
    </nav>
  );
}

function CustomerJourney({
  copy,
  step,
  surface,
  setStep,
}: {
  copy: Copy;
  step: CustomerStep;
  surface: "customer" | "mobile";
  setStep: (step: CustomerStep) => void;
}) {
  const labels = stepLabels(copy);
  const index = CUSTOMER_STEPS.indexOf(step);
  const previousStep = CUSTOMER_STEPS[Math.max(0, index - 1)] ?? "home";
  const nextStep =
    CUSTOMER_STEPS[Math.min(CUSTOMER_STEPS.length - 1, index + 1)] ?? "status";
  const content = (
    <>
      <header className="product-header">
        <a className="brand" href="#top" onClick={() => setStep("home")}>
          AGAT <span>PRINT</span>
        </a>
        {surface === "customer" && <CustomerNavigation copy={copy} />}
        <button
          className="avatar-button"
          aria-label={copy.orders}
          type="button"
        >
          A
        </button>
      </header>
      {step !== "home" && (
        <ol className="stepper" aria-label={copy.previewTitle}>
          {CUSTOMER_STEPS.slice(1).map((item, stepIndex) => (
            <li
              className={
                stepIndex + 1 === index
                  ? "active"
                  : stepIndex + 1 < index
                    ? "complete"
                    : ""
              }
              key={item}
            >
              <button onClick={() => setStep(item)} type="button">
                <span>{stepIndex + 1 < index ? "✓" : stepIndex + 1}</span>
                {labels[item]}
              </button>
            </li>
          ))}
        </ol>
      )}
      <main className="product-main">
        <CustomerScreen copy={copy} step={step} setStep={setStep} />
      </main>
      {step !== "home" && (
        <footer className="flow-actions">
          <button
            className="secondary-action"
            disabled={index <= 0}
            onClick={() => setStep(previousStep)}
            type="button"
          >
            ← {copy.previous}
          </button>
          <span>
            {index + 1} / {CUSTOMER_STEPS.length}
          </span>
          <button
            className="primary-action"
            disabled={index === CUSTOMER_STEPS.length - 1}
            onClick={() => setStep(nextStep)}
            type="button"
          >
            {copy.next} →
          </button>
        </footer>
      )}
      {surface === "mobile" && (
        <nav className="mobile-tabs" aria-label={copy.home}>
          <span className="active">
            ⌂<small>{copy.mobileTabHome}</small>
          </span>
          <span>
            ▤<small>{copy.mobileTabOrders}</small>
          </span>
          <span>
            ◌<small>{copy.mobileTabNotice}</small>
          </span>
        </nav>
      )}
    </>
  );
  return surface === "mobile" ? (
    <div className="phone-stage">
      <div className="phone-frame">
        <div className="phone-island" />
        <div className="phone-screen">{content}</div>
      </div>
    </div>
  ) : (
    <div className="web-frame">{content}</div>
  );
}

function StudioJourney({ copy }: { copy: Copy }) {
  return (
    <div className="studio-frame">
      <aside className="studio-sidebar">
        <a className="brand inverse" href="#top">
          AGAT <span>STUDIO</span>
        </a>
        <div className="branch-card">
          <span className="online-dot" />
          <div>
            <strong>{copy.studioBranch}</strong>
            <small>{copy.studioOnline}</small>
          </div>
        </div>
        <nav>
          <span className="active">▦ {copy.studioToday}</span>
          <span>▤ {copy.studioJobs}</span>
          <span>◉ {copy.studioVirtual}</span>
        </nav>
        <div className="studio-user">
          <span>A</span>
          <div>
            <strong>Aziz</strong>
            <small>Operator</small>
          </div>
        </div>
      </aside>
      <main className="studio-main">
        <header>
          <div>
            <span className="eyebrow">{copy.studioWorkspace}</span>
            <h1>{copy.studioToday}</h1>
          </div>
          <div className="studio-clock">
            12 OCT
            <br />
            <strong>14:32</strong>
          </div>
        </header>
        <section className="studio-stats">
          <article>
            <span>{copy.studioQueue}</span>
            <strong>4</strong>
            <small>+2</small>
          </article>
          <article>
            <span>{copy.studioActive}</span>
            <strong>2</strong>
            <small>●</small>
          </article>
          <article>
            <span>{copy.studioReady}</span>
            <strong>7</strong>
            <small>✓</small>
          </article>
        </section>
        <section className="studio-grid">
          <div className="studio-queue">
            <div className="section-heading compact">
              <h2>{copy.studioJobs}</h2>
              <span className="selection-pill">6</span>
            </div>
            {["AP-2048", "AP-2047", "AP-2046"].map((job, index) => (
              <button
                className={index === 0 ? "job-row active" : "job-row"}
                key={job}
                type="button"
              >
                <span className="job-thumb">{index === 1 ? "◫" : "Aa"}</span>
                <span>
                  <strong>{job}</strong>
                  <small>
                    {index === 0 ? copy.studioJob : copy.documentPrint}
                  </small>
                </span>
                <small>{copy.studioDeadline}</small>
              </button>
            ))}
          </div>
          <div className="job-detail">
            <div className="job-heading">
              <div>
                <span className="eyebrow">{copy.studioDetails}</span>
                <h2>AP-2048</h2>
              </div>
              <span className="live-pill">{copy.studioActive}</span>
            </div>
            <div className="job-item">
              <span className="job-thumb">Aa</span>
              <strong>{copy.studioDocument}</strong>
              <span>PDF</span>
            </div>
            <div className="job-item">
              <span className="job-thumb photo">◫</span>
              <strong>{copy.studioPhoto}</strong>
              <span>PNG</span>
            </div>
            <div className="virtual-panel">
              <strong>◉ {copy.studioVirtual}</strong>
              <p>{copy.studioVirtualNote}</p>
            </div>
            <div className="job-actions">
              <button disabled type="button">
                {copy.studioPrint}
              </button>
              <button disabled type="button">
                {copy.studioMarkReady}
              </button>
            </div>
          </div>
        </section>
        <section className="activity-line">
          <span>✓</span>
          <div>
            <strong>{copy.studioActivity}</strong>
            <small>{copy.studioActivityText} · 14:28</small>
          </div>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const initial = useMemo(() => readPreviewState(window.location.search), []);
  const [locale, setLocale] = useState<CustomerLocale>(initial.locale);
  const [surface, setSurface] = useState<PreviewSurface>(initial.surface);
  const [step, setStep] = useState<CustomerStep>(initial.step);
  const copy = getPreviewCopy(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    const state: PreviewState = { locale, surface, step };
    window.history.replaceState(null, "", writePreviewState(state));
  }, [locale, step, surface]);

  const surfaces: { value: PreviewSurface; label: string }[] = [
    { value: "customer", label: copy.customerSurface },
    { value: "mobile", label: copy.mobileSurface },
    { value: "studio", label: copy.studioSurface },
  ];

  return (
    <div className="preview-root" id="top">
      <header className="preview-header">
        <div className="preview-intro">
          <span className="preview-badge">{copy.previewBadge}</span>
          <div>
            <a className="brand" href="#top">
              {AGAT_BRAND.name}
            </a>
            <p>{copy.previewDescription}</p>
          </div>
        </div>
        <div className="preview-controls">
          <fieldset>
            <legend>{copy.surface}</legend>
            <div className="segmented-control">
              {surfaces.map((item) => (
                <button
                  aria-pressed={surface === item.value}
                  key={item.value}
                  onClick={() => setSurface(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{copy.language}</legend>
            <div className="locale-control">
              {SUPPORTED_LOCALES.map((item) => (
                <button
                  aria-label={localeLabels[item]}
                  aria-pressed={locale === item}
                  key={item}
                  onClick={() => setLocale(item)}
                  type="button"
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </header>
      <div className="preview-notice">ⓘ {copy.previewOnly}</div>
      <section className={`preview-canvas surface-${surface}`}>
        {surface === "studio" ? (
          <StudioJourney copy={copy} />
        ) : (
          <CustomerJourney
            copy={copy}
            setStep={setStep}
            step={step}
            surface={surface}
          />
        )}
      </section>
    </div>
  );
}
