import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@agat/ui/tokens.css";
import "./styles.css";
import { App } from "./App";
import { MarketplaceApp } from "./MarketplaceApp";
import { PremiumApp } from "./PremiumApp";

const PreviewApp = window.location.pathname.startsWith("/marketplace")
  ? MarketplaceApp
  : window.location.pathname.startsWith("/premium")
    ? PremiumApp
    : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
