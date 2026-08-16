import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { moscowToday, statusLabel, statusTone, weekdaysLabel, initials } from "../lib/format";
import { useScope, withBranch } from "../lib/scope";
import { Shell } from "../app/Shell";
import { Select } from "../ui/Select";
import ui from "./ui.module.css";

type Journal = {
  group: {
    crmId: string;
    name: string;
    branchName: string | null;
    instructorName: string | null;
    weekdays: string[];
  } | null;
  date: string;
  sessions: Array<{ id: string; label: string }>;
  students: Array<{ crmId: string; name: string; status: string; gup: string | null }>;
  marks: Record<string, string>;
  groups: Array<{ crmId: string; name: string; branchName: string | null }>;
};

export function JournalScreen() {
  const { branchCrmId } = useScope();
  const [params, setParams] = useSearchParams();
  const groupCrmId = params.get("group") ?? "";
  const date = params.get("date") ?? moscowToday();
  const [focus, setFocus] = useState({ row: 0, col: 0 });

  const journal = useQuery({
    queryKey: ["journal", groupCrmId, branchCrmId, date],
    queryFn: () =>
      api<Journal>(
        withBranch(
          `/v1/journal?groupCrmId=${encodeURIComponent(groupCrmId)}&date=${encodeURIComponent(date)}`,
          branchCrmId,
        ),
      ),
  });
  const data = journal.data;
  const sessions = (data?.sessions ?? []).slice(-12);
  const students = data?.students ?? [];

  const matrix = useMemo(() => {
    return students.map((student) =>
      sessions.map((session) => data?.marks[`${student.crmId}:${session.id}`] ?? "0"),
    );
  }, [students, sessions, data?.marks]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      const rows = students.length;
      const cols = sessions.length;
      if (rows === 0 || cols === 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocus((cur) => ({ row: Math.min(rows - 1, cur.row + 1), col: cur.col }));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocus((cur) => ({ row: Math.max(0, cur.row - 1), col: cur.col }));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setFocus((cur) => ({ row: cur.row, col: Math.min(cols - 1, cur.col + 1) }));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setFocus((cur) => ({ row: cur.row, col: Math.max(0, cur.col - 1) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [students.length, sessions.length]);

  return (
    <Shell title="Журнал">
      <div className={ui.pageHead}>
        <h2>{data?.group?.name ?? "Группа"}</h2>
        <div className={ui.toolbar}>
          <Select
            value={data?.group?.crmId ?? ""}
            options={(data?.groups ?? []).map((group) => ({
              value: group.crmId,
              label: group.name,
              hint: group.branchName ?? undefined,
            }))}
            onChange={(value) => setParams({ group: value, date })}
            placeholder="Группа"
          />
          <input
            className={ui.select}
            type="date"
            value={date}
            onChange={(event) => setParams({ group: groupCrmId || (data?.group?.crmId ?? ""), date: event.target.value })}
          />
        </div>
      </div>
      <p className={ui.muted}>
        {data?.group?.branchName} · {data?.group?.instructorName} ·{" "}
        {data?.group ? weekdaysLabel(data.group.weekdays) : ""} · стрелки по клеткам
      </p>
      <div className={ui.journal}>
        <table>
          <thead>
            <tr>
              <th>Ученик</th>
              {sessions.map((session) => (
                <th key={session.id} className={ui.mono} title={session.id}>
                  {session.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, row) => (
              <tr key={student.crmId}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={ui.avatar}>{initials(student.name)}</span>
                    <span>
                      {student.name}
                      <div className={ui.muted}>
                        <span className={`${ui.pill} ${ui[statusTone(student.status)]}`}>{statusLabel(student.status)}</span>{" "}
                        {student.gup ?? ""}
                      </div>
                    </span>
                  </div>
                </td>
                {sessions.map((session, col) => {
                  const value = matrix[row]?.[col] ?? "0";
                  const on = value !== "0";
                  const active = focus.row === row && focus.col === col;
                  return (
                    <td key={session.id}>
                      <button
                        type="button"
                        className={`${ui.mark} ${on ? ui.markOn : ""} ${active ? ui.markFocus : ""}`}
                        onClick={() => setFocus({ row, col })}
                      >
                        {on ? value : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
