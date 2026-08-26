import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";

export const metadata: Metadata = {
  title: "AGAT PRINT",
  description:
    "We print your ideas — безопасный онлайн-сервис печати в Ташкенте",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = {
  themeColor: "#58221B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <ServiceWorkerRegistration />
        <header className="topbar">
          <Link className="brand" href="/">
            AGAT <span>PRINT</span>
          </Link>
          <nav>
            <Link href="/profile">Профиль</Link>
            <Link href="/partner">Партнёрам</Link>
          </nav>
        </header>
        {children}
        <footer>Agat Print — we print your ideas</footer>
      </body>
    </html>
  );
}
