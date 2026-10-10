"use client";

import Link from "next/link";
import { customerCopy, useCustomerLocale } from "../lib/customer-i18n";
import { LanguageSwitcher } from "./language-switcher";

export function CustomerNavigation() {
  const locale = useCustomerLocale();
  const text = customerCopy(locale);
  return (
    <>
      <nav>
        <Link href={`/catalog?lang=${locale}`}>{text.catalog}</Link>
        <Link href={`/orders?lang=${locale}`}>{text.orders}</Link>
        <Link href={`/basket?lang=${locale}`}>{text.basket}</Link>
        <Link href={`/notifications?lang=${locale}`}>{text.notifications}</Link>
        <Link href="/partner">{text.partners}</Link>
      </nav>
      <LanguageSwitcher />
    </>
  );
}
