"use client";

import { usePathname } from "next/navigation";
import type { CustomerLocale } from "../lib/customer-i18n";

const locales: CustomerLocale[] = ["uz", "ru", "en"];

export function LanguageSwitcher() {
  const pathname = usePathname();
  return (
    <div className="language" aria-label="Til / Язык / Language">
      {locales.map((locale) => {
        return (
          <a key={locale} href={`${pathname}?lang=${locale}`}>
            {locale.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
