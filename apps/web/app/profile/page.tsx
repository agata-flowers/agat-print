import Link from "next/link";

export default function ProfilePage() {
  return (
    <main className="narrow">
      <p className="eyebrow">Личный кабинет</p>
      <h1>Профиль клиента</h1>
      <div className="panel">
        <h2>Ваши заказы сохранены</h2>
        <p>Продолжите незавершённое оформление или проверьте текущий статус.</p>
        <div className="actions">
          <Link className="button primary" href="/catalog">
            Новый заказ
          </Link>
          <Link className="button secondary" href="/drafts">
            Продолжить оформление
          </Link>
          <Link className="button secondary" href="/orders">
            Мои заказы
          </Link>
        </div>
      </div>
    </main>
  );
}
