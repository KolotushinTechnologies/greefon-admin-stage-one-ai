import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { initials, weekdaysLabel } from "../lib/format";
import { useScope } from "../lib/scope";
import { Shell } from "../app/Shell";
import { GroupsBlock } from "./Groups";
import ui from "./ui.module.css";

type Hall = {
  _id: string;
  crmId: string;
  name: string;
  status: string;
  comment: string | null;
  groupCount: number;
  instructorNames: string[];
  groups: Array<{
    crmId: string;
    name: string;
    weekdays: string[];
    timeNote: string | null;
    potential: number | null;
    instructorName: string | null;
  }>;
};

type Tab = "halls" | "groups" | "trainers";

export function HallsScreen() {
  const navigate = useNavigate();
  const { branchCrmId } = useScope();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const trainer = params.get("trainer");
  const tab = (params.get("tab") as Tab | null) ?? "halls";
  const halls = useQuery({ queryKey: ["halls"], queryFn: () => api<{ items: Hall[] }>("/v1/branches") });
  const items = (halls.data?.items ?? []).filter((item) => (branchCrmId ? item.crmId === branchCrmId : true));
  const hall = items.find((item) => item._id === selected) ?? items[0];

  const trainers = useMemo(() => {
    const map = new Map<string, { name: string; halls: string[]; groups: Array<{ crmId: string; name: string }> }>();
    for (const item of halls.data?.items ?? []) {
      for (const group of item.groups) {
        const name = group.instructorName ?? "без тренера";
        const row = map.get(name) ?? { name, halls: [], groups: [] };
        if (!row.halls.includes(item.name)) {
          row.halls.push(item.name);
        }
        row.groups.push({ crmId: group.crmId, name: group.name });
        map.set(name, row);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [halls.data?.items]);

  const pickedTrainer = trainers.find((item) => item.name === trainer) ?? trainers[0];

  const inspector =
    tab === "trainers" && pickedTrainer ? (
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-0.04em" }}>{pickedTrainer.name}</h2>
        <p className={ui.muted}>{pickedTrainer.halls.join(" · ")}</p>
        {pickedTrainer.groups.map((group) => (
          <button key={group.crmId} className={ui.row} onClick={() => navigate(`/journal?group=${group.crmId}`)}>
            <span>{group.name}</span>
          </button>
        ))}
      </div>
    ) : tab === "halls" && hall ? (
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-0.04em" }}>{hall.name}</h2>
        <p className={ui.muted}>
          {hall.groupCount} групп · {hall.instructorNames.join(", ") || "тренеры не размечены"}
        </p>
        <p className={ui.muted}>Аренда и помесячные метрики — слот, данные подтянем отдельным полем.</p>
        <h3 style={{ fontSize: 15 }}>Тренеры</h3>
        <p className={ui.muted}>{hall.instructorNames.join(" · ") || "—"}</p>
        {hall.groups.map((group) => (
          <button key={group.crmId} className={ui.row} onClick={() => navigate(`/journal?group=${group.crmId}`)}>
            <span>
              {group.name}
              <br />
              <small>
                {weekdaysLabel(group.weekdays)} · {group.instructorName}
              </small>
            </span>
          </button>
        ))}
      </div>
    ) : (
      <p className={ui.muted}>Группа открывается в журнале.</p>
    );

  return (
    <Shell title="Залы" inspector={inspector}>
      <div className={ui.seg}>
        <button className={tab === "halls" ? ui.on : ""} onClick={() => setParams({ tab: "halls" })}>
          Филиалы
        </button>
        <button className={tab === "groups" ? ui.on : ""} onClick={() => setParams({ tab: "groups" })}>
          Группы
        </button>
        <button className={tab === "trainers" ? ui.on : ""} onClick={() => setParams({ tab: "trainers" })}>
          Тренеры
        </button>
      </div>
      {tab === "groups" ? (
        <GroupsBlock />
      ) : tab === "trainers" ? (
        <div className={ui.list}>
          {trainers.map((item) => (
            <button
              key={item.name}
              className={`${ui.row} ${pickedTrainer?.name === item.name ? ui.on : ""}`}
              onClick={() => setParams({ tab: "trainers", trainer: item.name })}
            >
              <span className={ui.avatar}>{initials(item.name)}</span>
              <span>
                {item.name}
                <br />
                <small>{item.halls.join(" · ")}</small>
              </span>
              <span className={ui.muted}>{item.groups.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={ui.list}>
          {items.map((item) => (
            <button
              key={item._id}
              className={`${ui.row} ${hall?._id === item._id ? ui.on : ""}`}
              onClick={() => setParams({ tab: "halls", id: item._id })}
            >
              <span className={ui.avatar}>{initials(item.name)}</span>
              <span>
                {item.name}
                <br />
                <small>{item.instructorNames.join(" · ")}</small>
              </span>
              <span className={ui.muted}>{item.groupCount}</span>
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}
