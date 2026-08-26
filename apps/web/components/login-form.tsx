"use client";
import { useState, type FormEvent } from "react";
import { apiRequest } from "../lib/api";

export function LoginForm() {
  const [phone, setPhone] = useState("+998");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState("");
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
          body: JSON.stringify({ phone, code, locale: "ru" }),
        });
        window.location.assign("/profile");
      }
    } catch {
      setMessage("Не удалось выполнить запрос. Проверьте данные.");
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        {step === "phone" ? "Номер телефона" : "Одноразовый код"}
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
        {step === "phone" ? "Получить код" : "Войти"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
