import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { initials, weekdaysLabel } from "../lib/format";
import { useScope, withBranch } from "../lib/scope";
import { Shell } from "../app/Shell";
import { BarChart, Donut, ProbList } from "../ui/charts";
import ui from "./ui.module.css";

type Today = {
  date: string;
  stats: Array<{ id: string; label: string; value: number }>;
  groups: Array<{
    crmId: string;
    name: string;
    timeNote: string | null;
    weekdays: string[];
    branchName: string | null;
    instructorName: string | null;
  }>;
};

type Insights = {
  statusBars: Array<{ id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" }>;
  statusDonut: Array<{ id: string; label: string; value: number; color: string }>;
  hallLoad: Array<{ id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" }>;
  probs: Array<{ id: string; label: string; p: number; note?: string }>;
  proposals: Array<{ id: string; title: string; detail: string }>;
};

const STAT_TO: Record<string, string> = {
  application: "/people?status=application",
  quarantine: "/people?status=quarantine",
  week_skipped: "/people?status=week_skipped",
  debts: "/payments?purpose=training",
  active: "/people?status=active",
  today_groups: "/journal",
};

function statValue(stats: Today["stats"] | undefined, id: string): number {
  return stats?.find((item) => item.id === id)?.value ?? 0;
}

export function TodayScreen() {
  const navigate = useNavigate();
  const { branchCrmId } = useScope();
  const today = useQuery({
    queryKey: ["today", branchCrmId],
    queryFn: () => api<Today>(withBranch("/v1/today", branchCrmId)),
  });
  const insights = useQuery({
    queryKey: ["insights", branchCrmId],
    queryFn: () => api<Insights>(withBranch("/v1/insights", branchCrmId)),
  });
  const stats = today.data?.stats ?? [];
  const groups = today.data?.groups ?? [];

  return (
    <Shell title="Сегодня">
      <div className={ui.pageHead}>
        <h2>{today.data?.date ?? "Москва"}</h2>
      </div>
      <div className={ui.bento}>
        <button className={ui.hero} onClick={() => navigate("/journal")}>
          <span className={ui.kicker}>Группы сегодня</span>
          <b>{statValue(stats, "today_groups")}</b>
          <div className={ui.glassNote}>
            {today.data?.date ?? "Москва"}. Журнал первой группы — главный ежедневный ход.
          </div>
        </button>
        <div className={ui.kpiStack}>
          <button className={ui.kpi} onClick={() => navigate("/people?status=application")}>
            <span className={ui.kicker}>Заявки</span>
            <b className={ui.kpiAccent}>{statValue(stats, "application")}</b>
            <span>Новые люди, ещё не в составе</span>
          </button>
          <button className={ui.kpi} onClick={() => navigate("/people?status=quarantine")}>
            <span className={ui.kicker}>Карантин</span>
            <b>{statValue(stats, "quarantine")}</b>
            <span>Не ставить в журнал, пока не вышли</span>
          </button>
        </div>
        <button className={ui.persona} onClick={() => navigate("/payments?purpose=training")}>
          <span className={ui.kicker}>Без оплаты месяца</span>
          <b>{statValue(stats, "debts")}</b>
          <p>Реестр зала. Онлайн — отдельным сегментом.</p>
        </button>
      </div>

      <div className={ui.chartGrid}>
        <section className={ui.panelCard}>
          <span className={ui.kicker}>Состав школы</span>
          <h3 className={ui.panelTitle}>Статусы</h3>
          {insights.data ? <Donut segments={insights.data.statusDonut} center={`${statValue(stats, "active")}`} /> : <p className={ui.muted}>Считаем…</p>}
        </section>
        <section className={ui.panelCard}>
          <span className={ui.kicker}>Вероятности</span>
          <h3 className={ui.panelTitle}>Риски дня</h3>
          {insights.data ? <ProbList items={insights.data.probs} /> : <p className={ui.muted}>Считаем…</p>}
        </section>
        <section className={ui.panelCard}>
          <span className={ui.kicker}>Нагрузка</span>
          <h3 className={ui.panelTitle}>Группы по залам</h3>
          {insights.data ? <BarChart items={insights.data.hallLoad} /> : <p className={ui.muted}>Считаем…</p>}
        </section>
      </div>

      <section className={ui.panelCard} style={{ marginBottom: 18 }}>
        <span className={ui.kicker}>ITF МФТ</span>
        <h3 className={ui.panelTitle}>Предложения агента развития</h3>
        <div className={ui.proposalList}>
          {(insights.data?.proposals ?? []).map((item) => (
            <article key={item.id} className={ui.proposal}>
              <h4>{item.title}</h4>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className={ui.stats}>
        {stats
          .filter((stat) => !["today_groups", "application", "quarantine", "debts"].includes(stat.id))
          .map((stat) => (
            <button key={stat.id} className={ui.stat} onClick={() => navigate(STAT_TO[stat.id] ?? "/")}>
              <span className={ui.kicker}>{stat.label}</span>
              <b>{stat.value}</b>
            </button>
          ))}
      </div>
      <div className={ui.list}>
        {groups.map((group) => (
          <button key={group.crmId} className={ui.row} onClick={() => navigate(`/journal?group=${group.crmId}`)}>
            <span className={ui.avatar}>{initials(group.branchName ?? group.name)}</span>
            <span>
              {group.name}
              <br />
              <small>
                {group.branchName} · {group.instructorName} · {weekdaysLabel(group.weekdays)}
              </small>
            </span>
            <span className={ui.muted}>{group.timeNote}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
