import { z } from "zod";
import type { AppEnv } from "../../config/env.js";

const nullableString = z.union([z.string(), z.number(), z.null()]).optional().transform((value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
});

const filialSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  comment: z.string().optional().nullable(),
  rent_type: z.string().optional().nullable(),
  rent_price: nullableString,
  disable_pay: nullableString,
});

const instructorSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  comment: z.string().optional().nullable(),
});

const groupSchema = z.object({
  id: z.coerce.string(),
  filial_id: z.coerce.string(),
  instructor_id: z.union([z.string(), z.number()]).optional().nullable(),
  name: z.string(),
  comment: z.string().optional().nullable(),
  schedule: z.string().optional().nullable(),
  potential: z.union([z.string(), z.number()]).optional().nullable(),
  filial_name: z.string().optional().nullable(),
  instructor_name: z.string().optional().nullable(),
  day_1: nullableString,
  day_2: nullableString,
  day_3: nullableString,
  day_4: nullableString,
  day_5: nullableString,
  day_6: nullableString,
  day_7: nullableString,
});

const clientSchema = z
  .object({
    id: z.coerce.string(),
    name: z.string(),
    bdate: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    gup: z.string().nullable().optional(),
    weight: nullableString,
    degree: z.string().nullable().optional(),
    passport_sm: z.string().nullable().optional(),
    med_certificate_date: z.string().nullable().optional(),
    insurance_date: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    inactive: nullableString,
    last_visit: z.string().nullable().optional(),
    last_comment: z.string().nullable().optional(),
    create_ts: z.string().nullable().optional(),
    group_id: nullableString,
    filial_id: nullableString,
    instructor_id: nullableString,
    account_id: nullableString,
    account_name: z.string().nullable().optional(),
    account_phone: z.string().nullable().optional(),
    account_email: z.string().nullable().optional(),
    account_add_name: z.string().nullable().optional(),
    account_add_phone: z.string().nullable().optional(),
    filial_name: z.string().nullable().optional(),
    group_name: z.string().nullable().optional(),
    instructor_name: z.string().nullable().optional(),
  })
  .passthrough();

const accountSchema = z.object({
  id: z.coerce.string(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  add_name: z.string().nullable().optional(),
  add_phone: z.string().nullable().optional(),
  create_ts: z.string().nullable().optional(),
});

const paymentSchema = z
  .object({
    id: z.coerce.string(),
    client_id: nullableString,
    client_name: z.string().nullable().optional(),
    purpose: z.string(),
    month: z.string().nullable().optional(),
    amount: z.coerce.string(),
    pay_ts: z.string().nullable().optional(),
    paid: nullableString,
    manual: nullableString,
    instructor_id: nullableString,
    group_id: nullableString,
    filial_id: nullableString,
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    acq_order: z.string().nullable().optional(),
    fiscal_order: z.string().nullable().optional(),
    creator_id: nullableString,
    creator_name: z.string().nullable().optional(),
    filial_name: z.string().nullable().optional(),
    group_name: z.string().nullable().optional(),
    instructor_name: z.string().nullable().optional(),
  })
  .passthrough();

const crmEventSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  date_start: z.string().nullable().optional(),
  date_end: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  creator_id: nullableString,
  padawans: nullableString,
});

const scheduleSessionSchema = z
  .object({
    id: z.coerce.string(),
  })
  .passthrough();

const looseScalar = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}, z.union([z.string(), z.number(), z.null()]).optional());

const bootgridSchema = <T extends z.ZodType>(row: T) =>
  z.object({
    current: looseScalar,
    rowCount: looseScalar,
    total: looseScalar,
    rows: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(row)),
  });

export type CrmFilial = z.infer<typeof filialSchema>;
export type CrmInstructor = z.infer<typeof instructorSchema>;
export type CrmGroup = z.infer<typeof groupSchema>;
export type CrmClient = z.infer<typeof clientSchema>;
export type CrmAccount = z.infer<typeof accountSchema>;
export type CrmPayment = z.infer<typeof paymentSchema>;
export type CrmCatalogEvent = z.infer<typeof crmEventSchema>;
export type CrmScheduleSession = z.infer<typeof scheduleSessionSchema>;

export type CrmClientStatusFilter =
  | "all"
  | "all_active"
  | "active"
  | "application"
  | "sampler"
  | "quarantine"
  | "week_skipped"
  | "leave"
  | "declined";

export type CrmPaymentPurpose = "training" | "online_training" | "online";

export type CrmCatalogKind = "comps" | "exams" | "camps";

export type CrmVisitRow = {
  clientId: string;
  clientName: string;
  clientStatus: string | null;
  clientBdate: string | null;
  monthPaymentAmount: string | null;
  paymentMonth: string | null;
  visitsCount: string | null;
  curMonthPaid: string | null;
  grey: string | null;
  marks: Array<{ scheduleCrmId: string; value: string }>;
};

type PostValue = string | readonly string[];

export class GreefonVedomostiClient {
  private sessionId: string | null = null;

  constructor(private readonly env: AppEnv) {}

  get enabled(): boolean {
    return this.env.CRM_LOGIN.length > 0 && this.env.CRM_PASSWORD.length > 0;
  }

  async login(): Promise<void> {
    const payload = await this.postJson("auth", {
      action: "login",
      edit_login: this.env.CRM_LOGIN,
      edit_password: this.env.CRM_PASSWORD,
      edit_id: "0",
    });
    const parsed = z.object({ session_id: z.string() }).parse(payload);
    this.sessionId = parsed.session_id;
  }

  async listFilials(): Promise<CrmFilial[]> {
    await this.ensureSession();
    const payload = await this.postJson("clients", { action: "get_filials" });
    return z.array(filialSchema).parse(payload);
  }

  async listInstructors(): Promise<CrmInstructor[]> {
    await this.ensureSession();
    const payload = await this.postJson("groups", { action: "get_instructors" });
    return z.array(instructorSchema).parse(payload);
  }

  async listGroups(): Promise<CrmGroup[]> {
    await this.ensureSession();
    const payload = await this.postJson("groups", {
      current: "1",
      rowCount: "-1",
      searchPhrase: "",
    });
    const parsed = bootgridSchema(groupSchema).parse(payload);
    return parsed.rows;
  }

  async listClients(status: CrmClientStatusFilter = "all"): Promise<CrmClient[]> {
    await this.ensureSession();
    const rows: CrmClient[] = [];
    let current = 1;
    const pageSize = 500;
    for (;;) {
      const payload = await this.postJson("clients", {
        current: String(current),
        rowCount: String(pageSize),
        searchPhrase: "",
        client_status: status,
      });
      const parsed = bootgridSchema(clientSchema).parse(payload);
      rows.push(...parsed.rows);
      const total = Number(parsed.total ?? rows.length);
      if (rows.length >= total || parsed.rows.length === 0) {
        break;
      }
      current += 1;
    }
    return rows;
  }

  async listAccounts(): Promise<CrmAccount[]> {
    await this.ensureSession();
    const payload = await this.postJson("clients", { action: "get_accounts" });
    const parsed = z.object({ rows: z.array(accountSchema) }).parse(payload);
    return parsed.rows;
  }

  async listPayments(purposes: readonly CrmPaymentPurpose[]): Promise<CrmPayment[]> {
    await this.ensureSession();
    const rows: CrmPayment[] = [];
    let current = 1;
    const pageSize = 500;
    for (;;) {
      const payload = await this.postJson("payments", {
        current: String(current),
        rowCount: String(pageSize),
        searchPhrase: "",
        purpose: purposes,
      });
      const parsed = bootgridSchema(paymentSchema).parse(payload);
      rows.push(...parsed.rows);
      const total = Number(parsed.total ?? rows.length);
      if (rows.length >= total || parsed.rows.length === 0) {
        break;
      }
      current += 1;
    }
    return rows;
  }

  async listCatalogEvents(kind: CrmCatalogKind): Promise<CrmCatalogEvent[]> {
    await this.ensureSession();
    const payload = await this.postJson(kind, {
      current: "1",
      rowCount: "-1",
      searchPhrase: "",
    });
    const parsed = bootgridSchema(crmEventSchema).parse(payload);
    return parsed.rows;
  }

  async listScheduleSessionIds(groupCrmId: string): Promise<string[]> {
    await this.ensureSession();
    const html = await this.getHtml(`visits?group_id=${encodeURIComponent(groupCrmId)}`);
    const match = html.match(/"schedule_ids"\s*:\s*"(\[[^\]]*\])"/);
    if (!match?.[1]) {
      const alt = html.match(/schedule_ids["']?\s*[:=]\s*["'](\[[^\]]*\])["']/);
      if (!alt?.[1]) {
        return [];
      }
      return parseJsonStringArray(alt[1].replace(/\\"/g, '"'));
    }
    return parseJsonStringArray(match[1].replace(/\\"/g, '"'));
  }

  async listScheduleSessions(groupCrmId: string): Promise<CrmScheduleSession[]> {
    const ids = await this.listScheduleSessionIds(groupCrmId);
    if (ids.length === 0) {
      return [];
    }
    await this.ensureSession();
    try {
      const payload = await this.postJson("schedule", {
        current: "1",
        rowCount: "-1",
        searchPhrase: "",
        group_id: groupCrmId,
      });
      if (typeof payload === "string" && payload.includes("db error")) {
        return ids.map((id) => ({ id }));
      }
      const parsed = bootgridSchema(scheduleSessionSchema).safeParse(payload);
      if (!parsed.success) {
        return ids.map((id) => ({ id }));
      }
      const byId = new Map(parsed.data.rows.map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id) ?? { id });
    } catch {
      return ids.map((id) => ({ id }));
    }
  }

  async listVisits(groupCrmId: string, scheduleIds: readonly string[]): Promise<CrmVisitRow[]> {
    if (scheduleIds.length === 0) {
      return [];
    }
    await this.ensureSession();
    const payload = await this.postJson("visits", {
      current: "1",
      rowCount: "-1",
      searchPhrase: "",
      group_id: groupCrmId,
      to_current: "1",
      schedule_ids: JSON.stringify(scheduleIds),
    });
    const parsed = bootgridSchema(z.record(z.string(), z.unknown())).safeParse(payload);
    if (!parsed.success) {
      throw new Error(`visits parse ${groupCrmId}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
    return parsed.data.rows.map((row) => {
      const marks: Array<{ scheduleCrmId: string; value: string }> = [];
      for (const [key, value] of Object.entries(row)) {
        const match = /^schedule_id_(\d+)$/.exec(key);
        if (match?.[1]) {
          marks.push({ scheduleCrmId: match[1], value: String(value ?? "0") });
        }
      }
      return {
        clientId: String(row.client_id ?? ""),
        clientName: String(row.client_name ?? ""),
        clientStatus: row.client_status == null ? null : String(row.client_status),
        clientBdate: row.client_bdate == null ? null : String(row.client_bdate),
        monthPaymentAmount: row.month_payment_amount == null ? null : String(row.month_payment_amount),
        paymentMonth: row.payment_month == null ? null : String(row.payment_month),
        visitsCount: row.visits_count == null ? null : String(row.visits_count),
        curMonthPaid: row.cur_month_paid == null ? null : String(row.cur_month_paid),
        grey: row.grey == null ? null : String(row.grey),
        marks,
      };
    });
  }

  private async ensureSession(): Promise<void> {
    if (!this.sessionId) {
      await this.login();
    }
  }

  private async getHtml(path: string): Promise<string> {
    await this.ensureSession();
    const headers: Record<string, string> = { "User-Agent": "GreefonOS/1.0" };
    if (this.sessionId) {
      headers.Cookie = `session_id=${this.sessionId}`;
    }
    const response = await fetch(`${this.env.CRM_BASE_URL}/${path}`, { headers });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.sessionId = null;
      }
      throw new Error(`CRM GET ${path} ответила ${response.status}`);
    }
    return response.text();
  }

  private async postJson(page: string, data: Record<string, PostValue>, retried = false): Promise<unknown> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          body.append(`${key}[]`, item);
        }
      } else {
        body.append(key, value as string);
      }
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GreefonOS/1.0",
    };
    if (this.sessionId) {
      headers.Cookie = `session_id=${this.sessionId}`;
    }
    const response = await fetch(`${this.env.CRM_BASE_URL}/response.php?page=${page}`, {
      method: "POST",
      headers,
      body,
    });
    if ((response.status === 401 || response.status === 403) && !retried) {
      this.sessionId = null;
      await this.login();
      return this.postJson(page, data, true);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`CRM ${page} ответила ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}
