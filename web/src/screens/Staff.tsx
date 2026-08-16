import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { initials } from "../lib/format";
import { Shell } from "../app/Shell";
import ui from "./ui.module.css";

type Person = { telegramUserId: string; role: string; name: string };
type Coverage = { section: string; required: boolean; imported: boolean; count: number; notes: string };

export function StaffScreen() {
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => api<{ items: Person[] }>("/v1/staff"),
    retry: false,
  });
  const coverage = useQuery({
    queryKey: ["coverage"],
    queryFn: () => api<{ items: Coverage[] }>("/v1/coverage"),
  });

  return (
    <Shell title="Штат">
      <div className={ui.pageHead}>
        <h2>Доступ OS</h2>
        <span className={ui.muted}>Telegram-роли, не логины старой CRM</span>
      </div>
      {staff.error ? <p className={ui.muted}>{(staff.error as Error).message}</p> : null}
      <div className={ui.list}>
        {(staff.data?.items ?? []).map((person) => (
          <div key={person.telegramUserId} className={ui.row}>
            <span className={ui.avatar}>{initials(person.name)}</span>
            <span>{person.name}</span>
            <span className={`${ui.pill} ${ui.accent}`}>{person.role}</span>
          </div>
        ))}
      </div>
      <div className={ui.pageHead} style={{ marginTop: 28 }}>
        <h2>Паритет Ведомостей</h2>
      </div>
      <div className={ui.list}>
        {(coverage.data?.items ?? []).map((row) => (
          <div key={row.section} className={ui.row}>
            <span>
              {row.section}
              <br />
              <small>{row.notes}</small>
            </span>
            <span className={ui.mono}>{row.count}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
