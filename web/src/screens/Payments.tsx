import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { initials, money } from "../lib/format";
import { useScope, withBranch } from "../lib/scope";
import { Shell } from "../app/Shell";
import ui from "./ui.module.css";

type Pay = {
  _id: string;
  clientName: string | null;
  purpose: string;
  amountKopecks: number;
  month: string | null;
  payTs: string | null;
  phone: string | null;
  description: string | null;
};

export function PaymentsScreen() {
  const { branchCrmId } = useScope();
  const [params, setParams] = useSearchParams();
  const purpose = params.get("purpose") ?? "all";
  const q = params.get("q") ?? "";
  const selected = params.get("id");
  const list = useQuery({
    queryKey: ["payments", purpose, q, branchCrmId],
    queryFn: () =>
      api<{ total: number; items: Pay[] }>(
        withBranch(`/v1/payments?purpose=${purpose}&q=${encodeURIComponent(q)}&limit=80`, branchCrmId),
      ),
  });
  const item = list.data?.items.find((row) => row._id === selected);

  return (
    <Shell
      title="Оплаты"
      inspector={
        item ? (
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>{item.clientName ?? "Платёж"}</h2>
            <p className={ui.mono}>{money(item.amountKopecks)}</p>
            <p className={ui.muted}>
              {item.purpose === "training" ? "Зал" : "Онлайн"} · {item.month} · {item.payTs}
            </p>
            <p>{item.phone}</p>
            {item.description ? <p className={ui.muted}>{item.description}</p> : null}
          </div>
        ) : (
          <p className={ui.muted}>Зал и онлайн в одном реестре. Суммы из копеек.</p>
        )
      }
    >
      <div className={ui.pageHead}>
        <h2>Реестр</h2>
        <span className={ui.muted}>{list.data?.total ?? 0}</span>
      </div>
      <input
        className={ui.search}
        placeholder="Имя или телефон"
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
        {[
          ["all", "Все"],
          ["training", "Зал"],
          ["online", "Онлайн"],
        ].map(([id, label]) => (
          <Link key={id} className={purpose === id ? ui.on : ""} to={`/payments?purpose=${id}`}>
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
            <span className={ui.avatar}>{initials(row.clientName ?? "П")}</span>
            <span>
              {row.clientName ?? "без имени"}
              <br />
              <small>
                {row.purpose === "training" ? "зал" : "онлайн"} · {row.month ?? row.payTs}
              </small>
            </span>
            <span className={ui.mono}>{money(row.amountKopecks)}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
