import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { weekdaysLabel } from "../lib/format";
import { useScope } from "../lib/scope";
import ui from "./ui.module.css";
import { useNavigate } from "react-router-dom";

type Group = {
  _id: string;
  crmId: string;
  name: string;
  weekdays: string[];
  timeNote: string | null;
  potential: number | null;
  branchCrmId: string | null;
  branchName: string | null;
  instructorName: string | null;
};

export function GroupsBlock() {
  const navigate = useNavigate();
  const { branchCrmId } = useScope();
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<{ items: Group[] }>("/v1/groups") });
  const items = (groups.data?.items ?? []).filter((group) => (branchCrmId ? group.branchCrmId === branchCrmId : true));
  return (
    <div className={ui.list}>
      {items.map((group) => (
        <button key={group._id} className={ui.row} onClick={() => navigate(`/journal?group=${group.crmId}`)}>
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
  );
}
