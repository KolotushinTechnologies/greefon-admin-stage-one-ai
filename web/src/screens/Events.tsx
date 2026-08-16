import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Shell } from "../app/Shell";
import ui from "./ui.module.css";

type EventItem = {
  _id: string;
  kind: string;
  name: string;
  dateStart: string | null;
  dateEnd: string | null;
  comment: string | null;
  padawans: number | null;
};

export function EventsScreen() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as "comps" | "exams" | "camps" | null) ?? "comps";
  const selected = params.get("id");
  const list = useQuery({
    queryKey: ["events", kind],
    queryFn: () => api<{ items: EventItem[] }>(`/v1/events?kind=${kind}`),
  });
  const item = list.data?.items.find((row) => row._id === selected);

  return (
    <Shell
      title="События"
      inspector={
        item ? (
          <div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-0.04em" }}>{item.name}</h2>
            <p className={ui.muted}>
              {item.dateStart ?? "без даты"}
              {item.dateEnd ? ` — ${item.dateEnd}` : ""}
            </p>
            {item.comment ? <p>{item.comment}</p> : null}
            <p className={ui.muted}>Заявлено участников: {item.padawans ?? 0}</p>
            <p className={ui.muted}>Состав участников — уточним, пока CRM не отдала roster.</p>
          </div>
        ) : (
          <p className={ui.muted}>Состав участников CRM часто пустой — покажем, когда будет roster.</p>
        )
      }
    >
      <div className={ui.seg}>
        {[
          ["comps", "Соревнования"],
          ["exams", "Аттестации"],
          ["camps", "Лагеря"],
        ].map(([id, label]) => (
          <Link key={id} className={kind === id ? ui.on : ""} to={`/events?kind=${id}`}>
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
            <span>
              {row.name}
              <br />
              <small>
                {row.dateStart ?? "без даты"} {row.comment ? `· ${row.comment}` : ""}
              </small>
            </span>
            <span className={ui.muted}>{row.padawans ?? 0}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
