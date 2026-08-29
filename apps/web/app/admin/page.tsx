export default function AdminPage() {
  return (
    <main className="narrow">
      <p className="eyebrow">Ограниченный доступ</p>
      <h1>Администрирование</h1>
      <div className="panel">
        <h2>Модерация партнёров</h2>
        <p>
          Первый production-администратор создаётся только интерактивной
          одноразовой CLI-командой.
        </p>
        <a className="button primary" href="/admin/reviews">
          Очередь ручной проверки
        </a>
      </div>
    </main>
  );
}
