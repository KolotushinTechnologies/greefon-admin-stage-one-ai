import type { MongoConnection } from "../../infrastructure/mongo/mongo.client.js";
import { buildCoverageRows } from "../crm-import/coverage.js";
import type { CrmCatalogEvent, CrmPaymentRecord, CrmStudent, CrmVisitMark } from "../crm-import/types.js";
import type { OrgRepository } from "../org/org.repository.js";
import type { Weekday } from "../org/types.js";

export class OsQueryService {
  constructor(
    private readonly mongo: MongoConnection,
    private readonly org: OrgRepository,
  ) {}

  async today(input: { branchCrmId?: string } = {}) {
    const weekday = moscowWeekday();
    const groups = await this.org.listGroups({ includeClosedBranches: true });
    const branches = await this.org.listBranches(true);
    const instructors = await this.org.listInstructors();
    const scopedBranch = input.branchCrmId
      ? branches.find((branch) => branch.crmId === input.branchCrmId)
      : undefined;
    const todayGroups = groups.filter((group) => {
      if (!group.weekdays.includes(weekday)) {
        return false;
      }
      return scopedBranch ? group.branchId === scopedBranch._id : true;
    });
    const students = this.mongo.getDb().collection<CrmStudent>("crm_students");
    const [application, quarantine, weekSkipped, active] = await Promise.all([
      students.countDocuments({ status: "application" }),
      students.countDocuments({ status: "quarantine" }),
      students.countDocuments({ status: "week_skipped" }),
      students.countDocuments({ status: "active" }),
    ]);
    const month = moscowMonthStart();
    const unpaidApprox = await students.countDocuments({
      status: { $in: ["active", "week_skipped", "quarantine"] },
    });
    const paidThisMonth = await this.mongo
      .getDb()
      .collection<CrmPaymentRecord>("crm_payments")
      .distinct("clientCrmId", { purpose: "training", month, paid: true });
    const debts = Math.max(0, unpaidApprox - paidThisMonth.filter(Boolean).length);

    return {
      weekday,
      date: moscowDateLabel(),
      stats: [
        { id: "today_groups", label: "Группы сегодня", value: todayGroups.length },
        { id: "application", label: "Заявки", value: application },
        { id: "quarantine", label: "Карантин", value: quarantine },
        { id: "week_skipped", label: "Неделя пропуск", value: weekSkipped },
        { id: "debts", label: "Без оплаты месяца", value: debts },
        { id: "active", label: "Активные", value: active },
      ],
      groups: todayGroups.map((group) => ({
        id: group._id,
        crmId: group.crmId,
        name: group.name,
        timeNote: group.localOverride?.timeNote ?? group.timeNote,
        weekdays: group.weekdays,
        branchName: branches.find((item) => item._id === group.branchId)?.name ?? null,
        instructorName: instructors.find((item) => item._id === group.instructorId)?.name ?? null,
      })),
    };
  }

  async listStudents(input: {
    q?: string;
    status?: string;
    branchCrmId?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: CrmStudent[] }> {
    const query: Record<string, unknown> = {};
    if (input.status && input.status !== "all") {
      query.status = input.status;
    }
    if (input.branchCrmId) {
      query.branchCrmId = input.branchCrmId;
    }
    if (input.q && input.q.trim().length > 0) {
      const rx = new RegExp(escapeRegex(input.q.trim()), "i");
      query.$or = [
        { name: rx },
        { accountName: rx },
        { accountPhone: rx },
        { groupName: rx },
        { lastComment: rx },
      ];
    }
    const col = this.mongo.getDb().collection<CrmStudent>("crm_students");
    const total = await col.countDocuments(query);
    const items = await col.find(query).sort({ name: 1 }).skip(input.offset).limit(input.limit).toArray();
    return { total, items };
  }

  async getStudent(id: string): Promise<
    | (CrmStudent & {
        guardian: { name: string | null; phone: string | null; email: string | null; addName: string | null; addPhone: string | null } | null;
        recentPayments: CrmPaymentRecord[];
        recentVisits: Array<{ scheduleCrmId: string; value: string; groupCrmId: string }>;
      })
    | null
  > {
    const student =
      (await this.mongo.getDb().collection<CrmStudent>("crm_students").findOne({ _id: id })) ??
      (await this.mongo.getDb().collection<CrmStudent>("crm_students").findOne({ crmId: id }));
    if (!student) {
      return null;
    }
    const db = this.mongo.getDb();
    const [guardian, recentPayments, recentVisits] = await Promise.all([
      student.accountCrmId
        ? db.collection<{ name: string | null; phone: string | null; email: string | null; addName: string | null; addPhone: string | null }>("crm_guardians").findOne(
            { crmId: student.accountCrmId },
            { projection: { name: 1, phone: 1, email: 1, addName: 1, addPhone: 1 } },
          )
        : Promise.resolve(null),
      db.collection<CrmPaymentRecord>("crm_payments").find({ clientCrmId: student.crmId }).sort({ payTs: -1 }).limit(12).toArray(),
      db
        .collection<CrmVisitMark>("crm_visit_marks")
        .find({ clientCrmId: student.crmId })
        .sort({ scheduleCrmId: -1 })
        .limit(16)
        .toArray(),
    ]);
    return {
      ...student,
      guardian: guardian
        ? {
            name: guardian.name,
            phone: guardian.phone,
            email: guardian.email,
            addName: guardian.addName,
            addPhone: guardian.addPhone,
          }
        : null,
      recentPayments,
      recentVisits: recentVisits.map((row) => ({
        scheduleCrmId: row.scheduleCrmId,
        value: row.value,
        groupCrmId: row.groupCrmId,
      })),
    };
  }

  async listGuardians(input: { q?: string; limit: number; offset: number }) {
    const query: Record<string, unknown> = {};
    if (input.q && input.q.trim().length > 0) {
      const rx = new RegExp(escapeRegex(input.q.trim()), "i");
      query.$or = [{ name: rx }, { phone: rx }, { addName: rx }, { addPhone: rx }, { email: rx }];
    }
    const col = this.mongo.getDb().collection("crm_guardians");
    const total = await col.countDocuments(query);
    const items = await col.find(query).sort({ name: 1 }).skip(input.offset).limit(input.limit).toArray();
    return { total, items };
  }

  async listBranches() {
    const [branches, groups, instructors] = await Promise.all([
      this.org.listBranches(true),
      this.org.listGroups({ includeClosedBranches: true }),
      this.org.listInstructors(),
    ]);
    return branches.map((branch) => {
      const hallGroups = groups.filter((group) => group.branchId === branch._id);
      const instructorIds = new Set(hallGroups.map((group) => group.instructorId).filter(Boolean));
      return {
        ...branch,
        groupCount: hallGroups.length,
        instructorNames: instructors.filter((item) => instructorIds.has(item._id)).map((item) => item.name),
        groups: hallGroups.map((group) => ({
          id: group._id,
          crmId: group.crmId,
          name: group.name,
          weekdays: group.weekdays,
          timeNote: group.localOverride?.timeNote ?? group.timeNote,
          potential: group.potential,
          instructorName: instructors.find((item) => item._id === group.instructorId)?.name ?? null,
        })),
      };
    });
  }

  async listGroups() {
    const [groups, branches, instructors] = await Promise.all([
      this.org.listGroups({ includeClosedBranches: true }),
      this.org.listBranches(true),
      this.org.listInstructors(),
    ]);
    return groups.map((group) => {
      const branch = branches.find((item) => item._id === group.branchId);
      return {
        ...group,
        branchCrmId: branch?.crmId ?? null,
        branchName: branch?.name ?? null,
        instructorName: instructors.find((item) => item._id === group.instructorId)?.name ?? null,
      };
    });
  }

  async journal(input: { groupCrmId?: string; branchCrmId?: string; date?: string }) {
    const groups = await this.listGroups();
    const pool = input.branchCrmId ? groups.filter((item) => item.branchCrmId === input.branchCrmId) : groups;
    const group = pool.find((item) => item.crmId === input.groupCrmId) ?? pool[0] ?? groups[0];
    if (!group) {
      return { group: null, date: input.date ?? moscowIsoDate(), sessions: [], students: [], marks: {} as Record<string, string>, groups: [] };
    }
    const sessions = await this.mongo
      .getDb()
      .collection<{ crmId: string; groupCrmId: string; raw?: Record<string, unknown> }>("crm_schedule_sessions")
      .find({ groupCrmId: group.crmId })
      .sort({ crmId: 1 })
      .toArray();
    const students = await this.mongo
      .getDb()
      .collection<CrmStudent>("crm_students")
      .find({ groupCrmId: group.crmId, status: { $in: ["active", "week_skipped", "quarantine", "application"] } })
      .sort({ name: 1 })
      .toArray();
    const visitRows = await this.mongo
      .getDb()
      .collection<CrmVisitMark>("crm_visit_marks")
      .find({ groupCrmId: group.crmId })
      .toArray();
    const marks: Record<string, string> = {};
    for (const row of visitRows) {
      marks[`${row.clientCrmId}:${row.scheduleCrmId}`] = row.value;
    }
    return {
      group: {
        id: group._id,
        crmId: group.crmId,
        name: group.name,
        branchName: group.branchName,
        instructorName: group.instructorName,
        weekdays: group.weekdays,
        timeNote: group.timeNote,
      },
      date: input.date ?? moscowIsoDate(),
      sessions: sessions.map((session, index) => ({
        id: session.crmId,
        label: sessionLabel(session.raw, session.crmId, index, sessions.length),
      })),
      students: students.map((student) => ({
        id: student._id,
        crmId: student.crmId,
        name: student.name,
        status: student.status,
        gup: student.gup,
      })),
      marks,
      groups: (pool.length > 0 ? pool : groups).map((item) => ({
        crmId: item.crmId,
        name: item.name,
        branchName: item.branchName,
      })),
    };
  }

  async listPayments(input: {
    purpose?: "training" | "online" | "all";
    q?: string;
    branchCrmId?: string;
    limit: number;
    offset: number;
  }) {
    const query: Record<string, unknown> = {};
    if (input.purpose === "training") {
      query.purpose = "training";
    } else if (input.purpose === "online") {
      query.purpose = { $in: ["online", "online_training"] };
    }
    if (input.branchCrmId) {
      query.branchCrmId = input.branchCrmId;
    }
    if (input.q && input.q.trim().length > 0) {
      const rx = new RegExp(escapeRegex(input.q.trim()), "i");
      query.$or = [{ clientName: rx }, { phone: rx }, { email: rx }];
    }
    const col = this.mongo.getDb().collection<CrmPaymentRecord>("crm_payments");
    const total = await col.countDocuments(query);
    const items = await col.find(query).sort({ payTs: -1 }).skip(input.offset).limit(input.limit).toArray();
    return { total, items };
  }

  async listEvents(kind?: "comps" | "exams" | "camps") {
    const query = kind ? { kind } : {};
    return this.mongo
      .getDb()
      .collection<CrmCatalogEvent>("crm_catalog_events")
      .find(query)
      .sort({ dateStart: -1, name: 1 })
      .toArray();
  }

  async coverage() {
    const [branches, instructors, groups] = await Promise.all([
      this.org.listBranches(true),
      this.org.listInstructors(),
      this.org.listGroups({ includeClosedBranches: true }),
    ]);
    const db = this.mongo.getDb();
    return buildCoverageRows({
      students: await db.collection("crm_students").countDocuments(),
      guardians: await db.collection("crm_guardians").countDocuments(),
      branches: branches.length,
      instructors: instructors.length,
      groups: groups.length,
      visitMarks: await db.collection("crm_visit_marks").countDocuments(),
      scheduleSessions: await db.collection("crm_schedule_sessions").countDocuments(),
      paymentsTraining: await db.collection("crm_payments").countDocuments({ purpose: "training" }),
      paymentsOnline: await db
        .collection("crm_payments")
        .countDocuments({ purpose: { $in: ["online", "online_training"] } }),
      comps: await db.collection("crm_catalog_events").countDocuments({ kind: "comps" }),
      exams: await db.collection("crm_catalog_events").countDocuments({ kind: "exams" }),
      camps: await db.collection("crm_catalog_events").countDocuments({ kind: "camps" }),
    });
  }

  async insights(input: { branchCrmId?: string } = {}) {
    const students = this.mongo.getDb().collection<CrmStudent>("crm_students");
    const branchFilter = input.branchCrmId ? { branchCrmId: input.branchCrmId } : {};
    const [active, application, quarantine, weekSkipped, leave, declined, total] = await Promise.all([
      students.countDocuments({ ...branchFilter, status: "active" }),
      students.countDocuments({ ...branchFilter, status: "application" }),
      students.countDocuments({ ...branchFilter, status: "quarantine" }),
      students.countDocuments({ ...branchFilter, status: "week_skipped" }),
      students.countDocuments({ ...branchFilter, status: "leave" }),
      students.countDocuments({ ...branchFilter, status: "declined" }),
      students.countDocuments(branchFilter),
    ]);
    const month = moscowMonthStart();
    const unpaidApprox = Math.max(1, active + weekSkipped + quarantine);
    const paidThisMonth = await this.mongo
      .getDb()
      .collection<CrmPaymentRecord>("crm_payments")
      .distinct("clientCrmId", { purpose: "training", month, paid: true });
    const debts = Math.max(0, unpaidApprox - paidThisMonth.filter(Boolean).length);
    const payRisk = clamp01(debts / unpaidApprox);
    const convertRisk = clamp01(application / Math.max(1, application + active * 0.08));
    const returnRisk = clamp01((quarantine + weekSkipped) / Math.max(1, active + quarantine + weekSkipped));
    const leavePressure = clamp01(leave / Math.max(1, active + leave));
    const today = await this.today(input.branchCrmId ? { branchCrmId: input.branchCrmId } : {});
    const halls = await this.listBranches();
    const scopedHalls = input.branchCrmId ? halls.filter((item) => item.crmId === input.branchCrmId) : halls.filter((item) => item.status !== "closed");
    const hallLoad = scopedHalls
      .map((hall) => ({
        id: hall.crmId,
        label: hall.name,
        value: hall.groupCount,
        tone: "accent" as const,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const proposals = buildMftProposals({
      payRisk,
      convertRisk,
      returnRisk,
      leavePressure,
      application,
      debts,
      todayGroups: today.stats.find((item) => item.id === "today_groups")?.value ?? 0,
      comps: await this.mongo.getDb().collection("crm_catalog_events").countDocuments({ kind: "comps" }),
      exams: await this.mongo.getDb().collection("crm_catalog_events").countDocuments({ kind: "exams" }),
    });

    return {
      date: today.date,
      statusBars: [
        { id: "active", label: "Активные", value: active, tone: "ok" as const },
        { id: "application", label: "Заявки", value: application, tone: "accent" as const },
        { id: "quarantine", label: "Карантин", value: quarantine, tone: "gold" as const },
        { id: "week_skipped", label: "Пропуск", value: weekSkipped, tone: "gold" as const },
        { id: "leave", label: "Ушли", value: leave, tone: "danger" as const },
        { id: "declined", label: "Отказ", value: declined, tone: "danger" as const },
      ],
      statusDonut: [
        { id: "active", label: "Активные", value: active, color: "#2f6b4f" },
        { id: "application", label: "Заявки", value: application, color: "#1e3a5f" },
        { id: "quarantine", label: "Карантин", value: quarantine, color: "#c4a574" },
        { id: "other", label: "Прочее", value: Math.max(0, total - active - application - quarantine), color: "#5c5f6a" },
      ],
      hallLoad,
      probs: [
        {
          id: "pay",
          label: "Риск недоплаты месяца",
          p: payRisk,
          note: `${debts} без оплаты из ~${unpaidApprox} в контуре`,
        },
        {
          id: "convert",
          label: "Шанс дожать заявку в состав",
          p: clamp01(1 - convertRisk * 0.7),
          note: `${application} заявок ждут решения`,
        },
        {
          id: "return",
          label: "Вернуть из карантина/пропуска",
          p: clamp01(1 - returnRisk),
          note: `${quarantine + weekSkipped} вне нормального ритма`,
        },
        {
          id: "retain",
          label: "Удержать активных 30 дней",
          p: clamp01(1 - leavePressure * 1.2),
          note: "по leave vs active за месяц",
        },
      ],
      proposals,
    };
  }

  async griffinSuggest(path: string) {
    const insights = await this.insights({});
    const topRisk = [...insights.probs].sort((a, b) => b.p - a.p)[0];
    const topIdea = insights.proposals[0];
    if (path.startsWith("/people")) {
      return [
        { label: "Кто в заявках и что делать", ask: "разбери заявки и дай вероятности конверсии" },
        { label: "Карантин и возврат", ask: "кто в карантине и как вернуть в ритм" },
        { label: "Пропуск недели", ask: "кто пропустил неделю и риск оттока" },
      ];
    }
    if (path.startsWith("/journal")) {
      return [
        { label: "Кого отметить в первую очередь", ask: "подскажи приоритет журнала на сегодня" },
        { label: "Карантин vs журнал", ask: "кто в карантине и не должен быть в журнале" },
        { label: "Оплаты зала", ask: "риск недоплаты и кого дёргать по залу" },
      ];
    }
    if (path.startsWith("/payments")) {
      return [
        { label: "Риск недоплаты", ask: "вероятности по оплатам месяца" },
        { label: "Онлайн vs зал", ask: "сравни оплаты зала и онлайн" },
        { label: "Связь с активными", ask: "кто активен и без оплаты" },
      ];
    }
    return [
      {
        label: topRisk ? `Главный риск: ${topRisk.label}` : "Вероятности дня",
        ask: "вероятности дня и где дыры",
      },
      {
        label: topIdea ? topIdea.title : "Идеи ITF МФТ",
        ask: "идеи развития ITF МФТ",
      },
      { label: "Новые заявки", ask: "что делать с новыми заявками", to: "/people?status=application" },
    ];
  }

  async griffinAsk(text: string, input: { branchCrmId?: string } = {}) {
    const q = text.trim();
    if (q.length < 2) {
      return { text: "Напиши имя, зал, «оплаты», «мфт» или «вероятности».", blocks: [] as GriffinBlock[] };
    }
    const lower = q.toLowerCase();
    if (/вероят|риск|мфт|itf|развит|идея|график|оплат|карантин|заявк/.test(lower)) {
      const insights = await this.insights(input);
      return {
        text: "Срез дня и предложения по ITF МФТ.",
        blocks: [
          { type: "probs", title: "Вероятности", items: insights.probs },
          { type: "bars", title: "Состав статусов", items: insights.statusBars },
          { type: "actions", title: "Предложения ITF МФТ", items: insights.proposals },
        ] satisfies GriffinBlock[],
      };
    }
    const { items } = await this.listStudents({
      q,
      limit: 5,
      offset: 0,
      ...(input.branchCrmId ? { branchCrmId: input.branchCrmId } : {}),
    });
    if (items.length > 0) {
      const lines = items.map((item) => `- **${item.name}** · ${item.groupName ?? "без группы"} · ${item.status}`);
      return { text: `Нашёл в людях:\n${lines.join("\n")}`, blocks: [] as GriffinBlock[] };
    }
    const groups = await this.listGroups();
    const hit = groups
      .filter((group) => group.name.toLowerCase().includes(lower) || (group.branchName ?? "").toLowerCase().includes(lower))
      .slice(0, 5);
    if (hit.length > 0) {
      return {
        text: `Группы:\n${hit.map((group) => `- **${group.name}** · ${group.branchName ?? ""}`).join("\n")}`,
        blocks: [] as GriffinBlock[],
      };
    }
    return { text: "В нашей базе этого нет. Спроси «вероятности» или «идеи мфт» — дам графики.", blocks: [] as GriffinBlock[] };
  }
}

export type GriffinBlock =
  | { type: "bars"; title: string; items: Array<{ id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" }> }
  | { type: "probs"; title: string; items: Array<{ id: string; label: string; p: number; note?: string }> }
  | { type: "actions"; title: string; items: Array<{ id: string; title: string; detail: string }> };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function buildMftProposals(input: {
  payRisk: number;
  convertRisk: number;
  returnRisk: number;
  leavePressure: number;
  application: number;
  debts: number;
  todayGroups: number;
  comps: number;
  exams: number;
}): Array<{ id: string; title: string; detail: string }> {
  const items: Array<{ id: string; title: string; detail: string }> = [];
  if (input.payRisk > 0.35) {
    items.push({
      id: "pay-wave",
      title: "Волна закрытия долгов до аттестации",
      detail: `Риск недоплаты ${(input.payRisk * 100).toFixed(0)}%. Скрипт родителям зала + сегмент «без оплаты месяца» перед экзаменом гупов.`,
    });
  }
  if (input.application > 15) {
    items.push({
      id: "trial-funnel",
      title: "Воронка пробных → ITF-группа",
      detail: `${input.application} заявок. Закрепить тренерский звонок 48ч и пробное в той же маске недели, что целевая группа.`,
    });
  }
  if (input.returnRisk > 0.25) {
    items.push({
      id: "return-block",
      title: "Блок возврата из карантина",
      detail: "Отдельный слот «мягкого возврата» 1 занятие без полного темпа, потом снова в журнал группы.",
    });
  }
  if (input.exams < 5 || input.comps > 0) {
    items.push({
      id: "mft-calendar",
      title: "Календарь ITF МФТ под школу",
      detail: `В базе comps=${input.comps}, exams=${input.exams}. Синхронизировать даты МФТ РФ с составом гупов и заранее закрыть оплату/страховку.`,
    });
  }
  items.push({
    id: "pattern-day",
    title: "Pattern / sparring баланс сегодня",
    detail: `Сегодня ${input.todayGroups} групп. На залах с младшими — pattern+игры, на 10+ — 1 блок sparring с видеоразбором для МФТ-подготовки.`,
  });
  if (input.leavePressure > 0.2) {
    items.push({
      id: "retain",
      title: "Удержание перед оттоком",
      detail: "Личный контакт тренера тем, кто в leave-зоне: предложение лагеря/соревнования вместо «просто уйти».",
    });
  }
  return items.slice(0, 5);
}

function moscowWeekday(): Weekday {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Moscow", weekday: "short" })
    .format(new Date())
    .slice(0, 3)
    .toLowerCase();
  const map: Record<string, Weekday> = {
    mon: "mon",
    tue: "tue",
    wed: "wed",
    thu: "thu",
    fri: "fri",
    sat: "sat",
    sun: "sun",
  };
  return map[weekday] ?? "mon";
}

function moscowDateLabel(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function moscowIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sessionLabel(raw: Record<string, unknown> | undefined, crmId: string, index: number, total: number): string {
  if (raw) {
    for (const key of ["date", "start", "datetime", "ts", "day", "when"]) {
      const value = raw[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.length > 10 ? value.slice(0, 10) : value;
      }
    }
  }
  if (total <= 1) {
    return crmId;
  }
  return String(index + 1);
}

function moscowMonthStart(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  return `${parts}-01`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
