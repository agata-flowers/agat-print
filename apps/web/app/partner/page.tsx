import Link from "next/link";

export default function PartnerPage() {
  return (
    <main className="narrow">
      <p className="eyebrow">Для студий и типографий</p>
      <h1>Кабинет партнёра</h1>
      <div className="panel">
        <h2>Регистрация и проверка</h2>
        <p>
          Подайте название организации и первого филиала. Доступ партнёра
          откроется только после одобрения администратором.
        </p>
        <Link className="button primary" href="/login">
          Войти для регистрации
        </Link>
      </div>
    </main>
  );
}
