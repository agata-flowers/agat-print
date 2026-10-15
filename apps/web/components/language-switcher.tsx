"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { CustomerLocale } from "../lib/customer-i18n";

const locales: CustomerLocale[] = ["uz", "ru", "en"];

export function LanguageSwitcher() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<CustomerLocale>("ru");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locale = params.get("lang");
    setActive(locale === "uz" || locale === "en" ? locale : "ru");
    params.delete("lang");
    setQuery(params.toString());
  }, [pathname]);
  return (
    <div className="language" aria-label="Til / Язык / Language">
      {locales.map((locale) => {
        const params = new URLSearchParams(query);
        params.set("lang", locale);
        return (
          <a
            aria-current={active === locale ? "page" : undefined}
            key={locale}
            href={`${pathname}?${params.toString()}`}
          >
            {locale.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
