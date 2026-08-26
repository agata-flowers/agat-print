import { LoginForm } from "../../components/login-form";
export default function LoginPage() {
  return (
    <main className="narrow">
      <p className="eyebrow">Без пароля</p>
      <h1>Вход по телефону</h1>
      <p className="lead small">
        Для разработки используется одноразовый mock-код. В production
        mock-провайдер запрещён.
      </p>
      <LoginForm />
    </main>
  );
}
