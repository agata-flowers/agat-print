"use client";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../lib/api";
import { customerError, useCustomerLocale } from "../lib/customer-i18n";

export function LoginForm() {
  const locale = useCustomerLocale();
  const [phone, setPhone] = useState("+998");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState("");
  const [nextPath, setNextPath] = useState("/profile");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    if (requested && requested.startsWith("/") && !requested.startsWith("//"))
      setNextPath(requested);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      if (step === "phone") {
        await apiRequest("/auth/otp/request", {
          method: "POST",
          body: JSON.stringify({ phone }),
        });
        setStep("code");
        setMessage("Код отправлен.");
      } else {
        await apiRequest("/auth/otp/verify", {
          method: "POST",
          body: JSON.stringify({ phone, code, locale }),
        });
        window.location.assign(nextPath);
      }
    } catch (error) {
      setMessage(
        customerError(
          error instanceof Error ? error.message : "REQUEST_FAILED",
          locale,
        ),
      );
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        {step === "phone"
          ? locale === "uz"
            ? "Telefon raqami"
            : "Номер телефона"
          : locale === "uz"
            ? "Bir martalik kod"
            : "Одноразовый код"}
        <input
          inputMode={step === "phone" ? "tel" : "numeric"}
          autoComplete={step === "phone" ? "tel" : "one-time-code"}
          value={step === "phone" ? phone : code}
          onChange={(e) =>
            step === "phone"
              ? setPhone(e.target.value)
              : setCode(e.target.value)
          }
          required
        />
      </label>
      <button className="button primary" type="submit">
        {step === "phone"
          ? locale === "uz"
            ? "Kod olish"
            : "Получить код"
          : locale === "uz"
            ? "Kirish"
            : "Войти"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
