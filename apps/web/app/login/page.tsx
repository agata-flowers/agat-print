"use client";

import { LoginForm } from "../../components/login-form";
import { useCustomerLocale } from "../../lib/customer-i18n";
export default function LoginPage() {
  const locale = useCustomerLocale();
  return (
    <main className="narrow">
      <p className="eyebrow">{locale === "uz" ? "Parolsiz" : "Без пароля"}</p>
      <h1>{locale === "uz" ? "Telefon orqali kirish" : "Вход по телефону"}</h1>
      <p className="lead small">
        {locale === "uz"
          ? "Tasdiqlash kodi SMS orqali yuboriladi."
          : "Код подтверждения будет отправлен по SMS."}
      </p>
      <LoginForm />
    </main>
  );
}
