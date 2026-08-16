/** Baseline coverage of Greefon Ведомости sections for Greefon OS parity (except vendor /license). */

export type CoverageSectionId =
  | "clients"
  | "filials"
  | "instructors"
  | "groups"
  | "visits"
  | "schedule"
  | "payments"
  | "payments_online"
  | "comps"
  | "exams"
  | "camps"
  | "users"
  | "prefs";

export type CoverageDefinition = {
  id: CoverageSectionId;
  section: string;
  required: boolean;
  mongoCollections: string[];
  notes: string;
};

export const CRM_COVERAGE_BASELINE: readonly CoverageDefinition[] = [
  {
    id: "clients",
    section: "Клиенты",
    required: true,
    mongoCollections: ["crm_students"],
    notes: "Ученики со статусами; связь accountCrmId → crm_guardians",
  },
  {
    id: "filials",
    section: "Филиалы",
    required: true,
    mongoCollections: ["branches"],
    notes: "Уже через CrmSyncService; аренда/month_* — later",
  },
  {
    id: "instructors",
    section: "Инструкторы",
    required: true,
    mongoCollections: ["instructors"],
    notes: "Уже через CrmSyncService; salary — later",
  },
  {
    id: "groups",
    section: "Группы",
    required: true,
    mongoCollections: ["groups"],
    notes: "Уже через CrmSyncService + маска weekdays",
  },
  {
    id: "visits",
    section: "Посещения",
    required: true,
    mongoCollections: ["crm_visit_marks"],
    notes: "Матрица ученик×занятие; нужен schedule_ids группы",
  },
  {
    id: "schedule",
    section: "Расписание",
    required: true,
    mongoCollections: ["crm_schedule_sessions"],
    notes: "Ids занятий с visits HTML; полный bootgrid schedule хрупкий",
  },
  {
    id: "payments",
    section: "Платежи",
    required: true,
    mongoCollections: ["crm_payments"],
    notes: "purpose=training; суммы в копейках",
  },
  {
    id: "payments_online",
    section: "Платежи (онлайн)",
    required: true,
    mongoCollections: ["crm_payments"],
    notes: "purpose=online|online_training",
  },
  {
    id: "comps",
    section: "Соревнования",
    required: true,
    mongoCollections: ["crm_catalog_events"],
    notes: "kind=comps; состав участников — доразведка",
  },
  {
    id: "exams",
    section: "Аттестации",
    required: true,
    mongoCollections: ["crm_catalog_events"],
    notes: "kind=exams; не путать с school_events бота",
  },
  {
    id: "camps",
    section: "Лагеря",
    required: true,
    mongoCollections: ["crm_catalog_events"],
    notes: "kind=camps",
  },
  {
    id: "users",
    section: "Пользователи CRM",
    required: false,
    mongoCollections: [],
    notes: "Логины старой CRM; у нас Telegram RBAC — не 1:1",
  },
  {
    id: "prefs",
    section: "Настройки клуба",
    required: false,
    mongoCollections: [],
    notes: "prefs modal; /license вне scope продукта",
  },
] as const;

export type CoverageCounts = {
  students: number;
  guardians: number;
  branches: number;
  instructors: number;
  groups: number;
  visitMarks: number;
  scheduleSessions: number;
  paymentsTraining: number;
  paymentsOnline: number;
  comps: number;
  exams: number;
  camps: number;
};

export function buildCoverageRows(counts: CoverageCounts): Array<{
  section: string;
  required: boolean;
  imported: boolean;
  count: number;
  notes: string;
}> {
  return CRM_COVERAGE_BASELINE.map((item) => {
    const count = countFor(item.id, counts);
    const imported = item.required ? count > 0 : true;
    return {
      section: item.section,
      required: item.required,
      imported,
      count,
      notes: item.notes,
    };
  });
}

function countFor(id: CoverageSectionId, counts: CoverageCounts): number {
  switch (id) {
    case "clients":
      return counts.students;
    case "filials":
      return counts.branches;
    case "instructors":
      return counts.instructors;
    case "groups":
      return counts.groups;
    case "visits":
      return counts.visitMarks;
    case "schedule":
      return counts.scheduleSessions;
    case "payments":
      return counts.paymentsTraining;
    case "payments_online":
      return counts.paymentsOnline;
    case "comps":
      return counts.comps;
    case "exams":
      return counts.exams;
    case "camps":
      return counts.camps;
    case "users":
    case "prefs":
      return 0;
  }
}
