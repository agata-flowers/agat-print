import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Ташкент · RU / UZ</p>
        <h1>
          Печать начинается
          <br />
          до визита в студию.
        </h1>
        <p className="lead">
          Безопасно подготовьте заказ, подтвердите макет и передайте его
          проверенному партнёру AGAT PRINT.
        </p>
        <div className="actions">
          <Link className="button primary" href="/login">
            Войти по телефону
          </Link>
          <Link className="button secondary" href="/partner">
            Стать партнёром
          </Link>
        </div>
        <div className="scope">
          <strong>Фундамент платформы готовится</strong>
          <span>
            Загрузка документов появится только на следующем согласованном
            этапе.
          </span>
        </div>
      </section>
      <section className="features">
        <article>
          <span>01</span>
          <h2>Конфиденциальность</h2>
          <p>Документы не кэшируются, доступ ограничивается и аудируется.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Понятный процесс</h2>
          <p>Макет и цена подтверждаются до передачи в производство.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Локальные партнёры</h2>
          <p>Заказ получает подходящая студия в Ташкенте.</p>
        </article>
      </section>
    </main>
  );
}
