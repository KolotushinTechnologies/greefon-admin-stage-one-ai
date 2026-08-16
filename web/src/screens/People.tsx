import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { initials, money, statusLabel, statusTone, telLink, tgLink, waLink } from "../lib/format";
import { useScope, withBranch } from "../lib/scope";
import { Shell } from "../app/Shell";
import ui from "./ui.module.css";

type Student = {
  _id: string;
  crmId: string;
  name: string;
  status: string;
  gup: string | null;
  groupName: string | null;
  branchName: string | null;
  accountName: string | null;
  accountPhone: string | null;
  accountAddName: string | null;
  accountAddPhone: string | null;
  lastVisit: string | null;
  lastComment: string | null;
  birthDate: string | null;
  instructorName: string | null;
  guardian?: { name: string | null; phone: string | null; email: string | null; addName: string | null; addPhone: string | null } | null;
  recentPayments?: Array<{ crmId: string; amountKopecks: number; month: string | null; purpose: string }>;
  recentVisits?: Array<{ scheduleCrmId: string; value: string }>;
};

const STATUSES = [
  ["all", "Все"],
  ["active", "Активные"],
  ["application", "Заявки"],
  ["quarantine", "Карантин"],
  ["week_skipped", "Пропуск"],
  ["leave", "Ушли"],
  ["declined", "Отказ"],
];

export function PeopleScreen() {
  const { branchCrmId } = useScope();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const q = params.get("q") ?? "";
  const selected = params.get("id");

  const list = useQuery({
    queryKey: ["students", status, q, branchCrmId],
    queryFn: () =>
      api<{ total: number; items: Student[] }>(
        withBranch(
          `/v1/students?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&limit=80`,
          branchCrmId,
        ),
      ),
  });

  const detail = useQuery({
    queryKey: ["student", selected],
    queryFn: () => api<Student>(`/v1/students/${selected}`),
    enabled: Boolean(selected),
  });

  const person = detail.data;
  const phone = person?.guardian?.phone ?? person?.accountPhone ?? null;
  const parentName = person?.guardian?.name ?? person?.accountName ?? null;

  const inspector = person ? (
    <div>
      <span className={ui.avatarLg}>{initials(person.name)}</span>
      <h2 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-0.05em" }}>{person.name}</h2>
      <p className={ui.muted}>
        <span className={`${ui.pill} ${ui[statusTone(person.status)]}`}>{statusLabel(person.status)}</span>
        {" · "}
        {person.gup ?? "гуп —"} · {person.groupName ?? "без группы"}
      </p>
      <dl>
        <div className={ui.field}>
          <dt>Зал</dt>
          <dd>{person.branchName ?? "—"}</dd>
        </div>
        <div className={ui.field}>
          <dt>Тренер</dt>
          <dd>{person.instructorName ?? "—"}</dd>
        </div>
        <div className={ui.field}>
          <dt>Рождение</dt>
          <dd>{person.birthDate ?? "—"}</dd>
        </div>
        <div className={ui.field}>
          <dt>Родитель</dt>
          <dd>{parentName ?? "—"}</dd>
        </div>
        <div className={ui.field}>
          <dt>Телефон</dt>
          <dd>{phone ?? "—"}</dd>
        </div>
        {person.guardian?.addName || person.accountAddName ? (
          <div className={ui.field}>
            <dt>Второй контакт</dt>
            <dd>
              {person.guardian?.addName ?? person.accountAddName} · {person.guardian?.addPhone ?? person.accountAddPhone}
            </dd>
          </div>
        ) : null}
        <div className={ui.field}>
          <dt>Последний визит</dt>
          <dd>{person.lastVisit ?? "—"}</dd>
        </div>
        <div className={ui.field}>
          <dt>Комментарий</dt>
          <dd>{person.lastComment ?? "—"}</dd>
        </div>
      </dl>
      <div className={ui.links}>
        {telLink(phone) ? <a href={telLink(phone) ?? "#"}>Звонок</a> : null}
        {waLink(phone) ? (
          <a href={waLink(phone) ?? "#"} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : null}
        {tgLink(phone) ? (
          <a href={tgLink(phone) ?? "#"} target="_blank" rel="noreferrer">
            Telegram
          </a>
        ) : null}
      </div>
      <h3 style={{ fontSize: 15 }}>Посещаемость</h3>
      {(person.recentVisits ?? []).length === 0 ? <p className={ui.muted}>Нет отметок.</p> : null}
      {(person.recentVisits ?? []).slice(0, 8).map((visit) => (
        <div key={visit.scheduleCrmId} className={ui.muted}>
          занятие {visit.scheduleCrmId} · {visit.value === "0" ? "не был" : visit.value}
        </div>
      ))}
      <h3 style={{ fontSize: 15 }}>Оплаты</h3>
      {(person.recentPayments ?? []).map((pay) => (
        <div key={pay.crmId} className={ui.muted}>
          {money(pay.amountKopecks)} · {pay.month ?? pay.purpose}
        </div>
      ))}
    </div>
  ) : (
    <p className={ui.muted}>Выбери ученика — карточка ребёнка и родителя.</p>
  );

  return (
    <Shell title="Люди" inspector={inspector}>
      <div className={ui.pageHead}>
        <h2>Ученики</h2>
        <span className={ui.muted}>{list.data?.total ?? 0}</span>
      </div>
      <input
        className={ui.search}
        placeholder="ФИО или телефон"
        defaultValue={q}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            const next = new URLSearchParams(params);
            const value = event.currentTarget.value.trim();
            if (value) {
              next.set("q", value);
            } else {
              next.delete("q");
            }
            setParams(next);
          }
        }}
      />
      <div className={ui.seg}>
        {STATUSES.map(([id, label]) => (
          <Link
            key={id}
            className={status === id ? ui.on : ""}
            to={`/people?status=${id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className={ui.list}>
        {(list.data?.items ?? []).map((row) => (
          <button
            key={row._id}
            className={`${ui.row} ${selected === row._id ? ui.on : ""}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("id", row._id);
              setParams(next);
            }}
          >
            <span className={ui.avatar}>{initials(row.name)}</span>
            <span>
              {row.name}
              <br />
              <small>
                {row.groupName ?? "без группы"} · {row.accountPhone ?? "нет телефона"}
              </small>
            </span>
            <span className={`${ui.pill} ${ui[statusTone(row.status)]}`}>{statusLabel(row.status)}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
