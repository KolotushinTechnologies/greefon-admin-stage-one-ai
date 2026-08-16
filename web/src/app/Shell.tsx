import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  CircleUser,
  Command,
  CreditCard,
  Moon,
  Sun,
  Table2,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, clearSession } from "../lib/api";
import { useBrand } from "../lib/brand";
import { canSeePeople, canSeeStaff, moscowTodayLabel } from "../lib/format";
import { useScope, withBranch } from "../lib/scope";
import { applyTheme, readTheme, type Theme } from "../lib/theme";
import { GriffinChatPanel } from "../ui/GriffinChat";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import styles from "./shell.module.css";

const NAV = [
  { to: "/", label: "Сегодня", icon: CalendarDays, end: true, min: "operator" },
  { to: "/people", label: "Люди", icon: Users, end: false, min: "admin" },
  { to: "/halls", label: "Залы", icon: Building2, end: false, min: "operator" },
  { to: "/journal", label: "Журнал", icon: Table2, end: false, min: "operator" },
  { to: "/payments", label: "Оплаты", icon: CreditCard, end: false, min: "operator" },
  { to: "/events", label: "События", icon: Trophy, end: false, min: "operator" },
  { to: "/staff", label: "Штат", icon: CircleUser, end: false, min: "superadmin" },
];

type Hall = { crmId: string; name: string; status: string };
type Me = { user: { name: string; role: string; telegramUserId?: string } };

type Props = {
  title: string;
  inspector?: ReactNode;
  children: ReactNode;
};

export function Shell({ title, inspector, children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { branchCrmId, setBranchCrmId } = useScope();
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [griffin, setGriffin] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/me") });
  const halls = useQuery({ queryKey: ["halls"], queryFn: () => api<{ items: Hall[] }>("/v1/branches") });
  const brand = useBrand();
  const role = me.data?.user.role ?? "operator";
  const userId = me.data?.user.telegramUserId ?? "staff";

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setGriffin((value) => !value);
      }
      if (event.key === "Escape") {
        setPalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nav = useMemo(() => {
    return NAV.filter((item) => {
      if (item.min === "admin") {
        return canSeePeople(role);
      }
      if (item.min === "superadmin") {
        return canSeeStaff(role);
      }
      return true;
    });
  }, [role]);

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return nav;
    }
    return nav.filter((item) => item.label.toLowerCase().includes(q));
  }, [nav, query]);

  const hallOptions = useMemo(
    () => [
      { value: "", label: "Все залы" },
      ...(halls.data?.items ?? [])
        .filter((item) => item.status !== "closed")
        .map((item) => ({ value: item.crmId, label: item.name })),
    ],
    [halls.data?.items],
  );

  return (
    <div className={griffin ? `${styles.shell} ${styles.shellGriffin}` : styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.mark} title={brand.productName}>
          <img src="/greefon-wing.svg" alt="" />
        </div>
        <nav className={styles.nav}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) => (isActive ? styles.activeLink : "")}
            >
              <item.icon size={20} strokeWidth={1.75} />
            </NavLink>
          ))}
        </nav>
        <div className={styles.railBottom}>
          <button
            className={styles.iconBtn}
            title="Тема"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
          </button>
          <button className={styles.iconBtn} title="Команды ⌘K" onClick={() => setPalette(true)}>
            <Command size={20} strokeWidth={1.75} />
          </button>
          <div className={styles.profile} title={me.data?.user.name ?? "штаб"}>
            {(me.data?.user.name ?? "Г").slice(0, 1)}
          </div>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.chrome}>
          <h1>{title}</h1>
          <input
            className={styles.search}
            placeholder="Найти Колотушин…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) {
                navigate(`/people?q=${encodeURIComponent(query.trim())}`);
              }
            }}
          />
          <Select
            value={branchCrmId}
            options={hallOptions}
            onChange={setBranchCrmId}
            title="Филиал"
            className={styles.scopeSelect}
          />
          <span className={styles.date}>{moscowTodayLabel()}</span>
          <button className={styles.ghost} onClick={() => setGriffin((value) => !value)}>
            {brand.openAssistantLabel}
          </button>
          <button
            className={styles.ghost}
            onClick={() => {
              clearSession();
              navigate("/login");
            }}
          >
            Выйти
          </button>
        </header>
        <div className={styles.stage}>
          <div className={styles.canvas}>{children}</div>
          {inspector ? <aside className={styles.inspector}>{inspector}</aside> : null}
        </div>
      </div>
      {griffin ? <GriffinChatPanel userId={userId} path={location.pathname} branchCrmId={branchCrmId} /> : null}
      <Modal open={palette} title="Команды" onClose={() => setPalette(false)}>
        <input
          className={styles.paletteInput}
          autoFocus
          placeholder="Перейти или действие…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.paletteList}>
          {filteredNav.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => {
                navigate(item.to);
                setPalette(false);
              }}
            >
              {item.label}
            </button>
          ))}
          {query.trim() ? (
            <button
              type="button"
              onClick={() => {
                navigate(`/people?q=${encodeURIComponent(query.trim())}`);
                setPalette(false);
              }}
            >
              Найти «{query.trim()}» в людях
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              navigate(withBranch("/journal", branchCrmId));
              setPalette(false);
            }}
          >
            Отметить посещение — открыть журнал
          </button>
          <button
            type="button"
            onClick={() => {
              setGriffin(true);
              setPalette(false);
            }}
          >
            Открыть чат · {brand.assistantName}
          </button>
        </div>
      </Modal>
    </div>
  );
}
