import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession } from "../lib/api";
import { useBrand } from "../lib/brand";
import { applyTheme, readTheme } from "../lib/theme";
import ui from "./ui.module.css";

type AuthConfig = { devLogin: boolean; botUsername: string | null };
type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}

export function LoginScreen() {
  const navigate = useNavigate();
  const brand = useBrand();
  const widget = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    applyTheme(readTheme());
    void api<AuthConfig>("/v1/auth/config").then(setConfig).catch(() => setConfig({ devLogin: false, botUsername: null }));
  }, []);

  useEffect(() => {
    const node = widget.current;
    const username = config?.botUsername;
    if (!node || !username) {
      return;
    }
    window.onTelegramAuth = (user) => {
      setBusy(true);
      void api<{ token: string }>("/v1/auth/telegram", {
        method: "POST",
        body: JSON.stringify(user),
      })
        .then((result) => {
          setSession(result.token);
          navigate("/");
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Telegram не пустил"))
        .finally(() => setBusy(false));
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    node.replaceChildren(script);
    return () => {
      node.replaceChildren();
      delete window.onTelegramAuth;
    };
  }, [config?.botUsername, navigate]);

  return (
    <div className={ui.login}>
      <div className={ui.card}>
        <img className={ui.loginWing} src="/greefon-wing.svg" alt="" />
        <h1>{brand.productName}</h1>
        <p>Штабная система школы. Родители остаются в Telegram.</p>
        <div ref={widget} className={ui.widget} />
        {config?.devLogin ? (
          <button
            className={ui.primary}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api<{ token: string }>("/v1/auth/dev", { method: "POST" })
                .then((result) => {
                  setSession(result.token);
                  navigate("/");
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Не вошёл"))
                .finally(() => setBusy(false));
            }}
          >
            Войти как штаб
          </button>
        ) : null}
        <p className={ui.muted} style={{ marginTop: 16 }}>
          Вход по Telegram Login Widget. Роль выдаётся в боте, паролей CRM нет.
        </p>
        {error ? <p className={ui.error}>{error}</p> : null}
      </div>
    </div>
  );
}
