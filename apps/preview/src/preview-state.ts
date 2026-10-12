import { localeFrom, type CustomerLocale } from "@agat/i18n";

export const PREVIEW_SURFACES = ["customer", "mobile", "studio"] as const;
export type PreviewSurface = (typeof PREVIEW_SURFACES)[number];

export const CUSTOMER_STEPS = [
  "home",
  "service",
  "upload",
  "settings",
  "preview",
  "basket",
  "checkout",
  "status",
] as const;
export type CustomerStep = (typeof CUSTOMER_STEPS)[number];

export const surfaceFrom = (value: string | null): PreviewSurface =>
  PREVIEW_SURFACES.includes(value as PreviewSurface)
    ? (value as PreviewSurface)
    : "customer";

export const stepFrom = (value: string | null): CustomerStep =>
  CUSTOMER_STEPS.includes(value as CustomerStep)
    ? (value as CustomerStep)
    : "home";

export interface PreviewState {
  locale: CustomerLocale;
  surface: PreviewSurface;
  step: CustomerStep;
}

export const readPreviewState = (search: string): PreviewState => {
  const params = new URLSearchParams(search);
  return {
    locale: localeFrom(params.get("lang")),
    surface: surfaceFrom(params.get("surface")),
    step: stepFrom(params.get("step")),
  };
};

export const writePreviewState = (state: PreviewState): string => {
  const params = new URLSearchParams({
    lang: state.locale,
    surface: state.surface,
    step: state.step,
  });
  return `?${params.toString()}`;
};
