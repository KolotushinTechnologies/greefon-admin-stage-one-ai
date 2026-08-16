import type { CrmPayment, GreefonVedomostiClient } from "../../infrastructure/crm-vedomosti/vedomosti.client.js";
import type { CrmSyncService } from "../org/crm-sync.service.js";
import type { OrgRepository } from "../org/org.repository.js";
import { buildCoverageRows } from "./coverage.js";
import type { CrmOpsRepository, CrmPeopleRepository } from "./crm-data.repository.js";
import type { CrmImportReport, CrmPaymentRecord } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class CrmImportService {
  constructor(
    private readonly crm: GreefonVedomostiClient,
    private readonly crmSync: CrmSyncService,
    private readonly org: OrgRepository,
    private readonly crmPeople: CrmPeopleRepository,
    private readonly crmOps: CrmOpsRepository,
  ) {}

  async importAll(options: { includeVisits?: boolean } = {}): Promise<CrmImportReport> {
    const includeVisits = options.includeVisits ?? true;
    if (!this.crm.enabled) {
      throw new Error("CRM_LOGIN/CRM_PASSWORD пустые — импорт невозможен.");
    }

    const org = await this.crmSync.sync();
    const people = await this.importPeople();
    const payments = await this.importPayments();
    const catalog = await this.importCatalog();
    const visits = includeVisits
      ? await this.importVisits()
      : { scheduleSessions: 0, visitMarks: 0, groupsWithVisits: 0, groupsFailedVisits: [] as string[] };

    const branches = (await this.org.listBranches(true)).length;
    const instructors = (await this.org.listInstructors()).length;
    const groups = (await this.org.listGroups({ includeClosedBranches: true })).length;

    const report: CrmImportReport = {
      at: new Date().toISOString(),
      org: { branches: org.branches, instructors: org.instructors, groups: org.groups },
      people: {
        students: people.students,
        guardians: people.guardians,
        expectedStudents: people.expectedStudents,
        expectedGuardians: people.expectedGuardians,
      },
      ops: {
        paymentsTraining: payments.training,
        paymentsOnline: payments.online,
        scheduleSessions: visits.scheduleSessions,
        visitMarks: visits.visitMarks,
        groupsWithVisits: visits.groupsWithVisits,
        groupsFailedVisits: visits.groupsFailedVisits,
      },
      catalog,
      coverage: buildCoverageRows({
        students: await this.crmPeople.countStudents(),
        guardians: await this.crmPeople.countGuardians(),
        branches,
        instructors,
        groups,
        visitMarks: await this.crmOps.countVisitMarks(),
        scheduleSessions: await this.crmOps.countSessions(),
        paymentsTraining: await this.crmOps.countPayments("training"),
        paymentsOnline: await this.crmOps.countPayments("online"),
        comps: await this.crmOps.countCatalog("comps"),
        exams: await this.crmOps.countCatalog("exams"),
        camps: await this.crmOps.countCatalog("camps"),
      }),
    };
    await this.crmOps.saveImportReport(report);
    return report;
  }

  async coverageSnapshot(): Promise<CrmImportReport["coverage"]> {
    const branches = (await this.org.listBranches(true)).length;
    const instructors = (await this.org.listInstructors()).length;
    const groups = (await this.org.listGroups({ includeClosedBranches: true })).length;
    return buildCoverageRows({
      students: await this.crmPeople.countStudents(),
      guardians: await this.crmPeople.countGuardians(),
      branches,
      instructors,
      groups,
      visitMarks: await this.crmOps.countVisitMarks(),
      scheduleSessions: await this.crmOps.countSessions(),
      paymentsTraining: await this.crmOps.countPayments("training"),
      paymentsOnline: await this.crmOps.countPayments("online"),
      comps: await this.crmOps.countCatalog("comps"),
      exams: await this.crmOps.countCatalog("exams"),
      camps: await this.crmOps.countCatalog("camps"),
    });
  }

  async importPeople(): Promise<{
    students: number;
    guardians: number;
    expectedStudents: number;
    expectedGuardians: number;
  }> {
    const now = new Date();
    const accounts = await this.crm.listAccounts();
    await this.crmPeople.upsertGuardians(
      accounts.map((account) => ({
        crmId: account.id,
        name: emptyToNull(account.name),
        phone: emptyToNull(account.phone),
        email: emptyToNull(account.email),
        addName: emptyToNull(account.add_name),
        addPhone: emptyToNull(account.add_phone),
        createTs: emptyToNull(account.create_ts),
        syncedAt: now,
      })),
    );

    const clients = await this.crm.listClients("all");
    await this.crmPeople.upsertStudents(
      clients.map((client) => ({
        crmId: client.id,
        name: client.name,
        birthDate: emptyToNull(client.bdate),
        gender: emptyToNull(client.gender),
        gup: emptyToNull(client.gup),
        weight: emptyToNull(client.weight),
        degree: emptyToNull(client.degree),
        passportSm: emptyToNull(client.passport_sm),
        medCertificateDate: emptyToNull(client.med_certificate_date),
        insuranceDate: emptyToNull(client.insurance_date),
        status: emptyToNull(client.status) ?? "unknown",
        inactive: client.inactive === "1",
        lastVisit: emptyToNull(client.last_visit),
        lastComment: emptyToNull(client.last_comment),
        createTs: emptyToNull(client.create_ts),
        groupCrmId: emptyToNull(client.group_id),
        branchCrmId: emptyToNull(client.filial_id),
        instructorCrmId: emptyToNull(client.instructor_id),
        accountCrmId: emptyToNull(client.account_id),
        accountName: emptyToNull(client.account_name),
        accountPhone: emptyToNull(client.account_phone),
        accountEmail: emptyToNull(client.account_email),
        accountAddName: emptyToNull(client.account_add_name),
        accountAddPhone: emptyToNull(client.account_add_phone),
        branchName: emptyToNull(client.filial_name),
        groupName: emptyToNull(client.group_name),
        instructorName: emptyToNull(client.instructor_name),
        syncedAt: now,
      })),
    );

    return {
      students: clients.length,
      guardians: accounts.length,
      expectedStudents: clients.length,
      expectedGuardians: accounts.length,
    };
  }

  async importPayments(): Promise<{ training: number; online: number }> {
    const now = new Date();
    const training = await this.crm.listPayments(["training"]);
    await this.crmOps.upsertPayments(training.map((payment) => mapPayment(payment, now)));
    await sleep(300);
    const online = await this.crm.listPayments(["online_training", "online"]);
    await this.crmOps.upsertPayments(online.map((payment) => mapPayment(payment, now)));
    return { training: training.length, online: online.length };
  }

  async importCatalog(): Promise<{ comps: number; exams: number; camps: number }> {
    const now = new Date();
    const comps = await this.crm.listCatalogEvents("comps");
    const exams = await this.crm.listCatalogEvents("exams");
    const camps = await this.crm.listCatalogEvents("camps");
    await this.crmOps.upsertCatalogEvents([
      ...comps.map((event) => ({
        kind: "comps" as const,
        crmId: event.id,
        name: event.name,
        dateStart: emptyToNull(event.date_start),
        dateEnd: emptyToNull(event.date_end),
        comment: emptyToNull(event.comment),
        creatorCrmId: emptyToNull(event.creator_id),
        padawans: event.padawans == null ? null : Number(event.padawans),
        syncedAt: now,
      })),
      ...exams.map((event) => ({
        kind: "exams" as const,
        crmId: event.id,
        name: event.name,
        dateStart: emptyToNull(event.date_start),
        dateEnd: emptyToNull(event.date_end),
        comment: emptyToNull(event.comment),
        creatorCrmId: emptyToNull(event.creator_id),
        padawans: event.padawans == null ? null : Number(event.padawans),
        syncedAt: now,
      })),
      ...camps.map((event) => ({
        kind: "camps" as const,
        crmId: event.id,
        name: event.name,
        dateStart: emptyToNull(event.date_start),
        dateEnd: emptyToNull(event.date_end),
        comment: emptyToNull(event.comment),
        creatorCrmId: emptyToNull(event.creator_id),
        padawans: event.padawans == null ? null : Number(event.padawans),
        syncedAt: now,
      })),
    ]);
    return { comps: comps.length, exams: exams.length, camps: camps.length };
  }

  async importVisits(): Promise<{
    scheduleSessions: number;
    visitMarks: number;
    groupsWithVisits: number;
    groupsFailedVisits: string[];
  }> {
    const now = new Date();
    const groups = await this.crm.listGroups();
    let scheduleSessions = 0;
    let visitMarks = 0;
    let groupsWithVisits = 0;
    const groupsFailedVisits: string[] = [];

    for (const group of groups) {
      try {
        const scheduleIds = await this.crm.listScheduleSessionIds(group.id);
        await this.crmOps.upsertScheduleSessions(
          scheduleIds.map((sessionId) => ({
            crmId: sessionId,
            groupCrmId: group.id,
            raw: { id: sessionId },
            syncedAt: now,
          })),
        );
        scheduleSessions += scheduleIds.length;
        if (scheduleIds.length === 0) {
          continue;
        }
        const rows = await this.crm.listVisits(group.id, scheduleIds);
        const marks = rows.flatMap((row) => {
          if (!row.clientId) {
            return [];
          }
          return row.marks.map((mark) => ({
            groupCrmId: group.id,
            clientCrmId: row.clientId,
            scheduleCrmId: mark.scheduleCrmId,
            value: mark.value,
            clientName: emptyToNull(row.clientName),
            clientStatus: emptyToNull(row.clientStatus),
            syncedAt: now,
          }));
        });
        await this.crmOps.upsertVisitMarks(marks);
        visitMarks += marks.length;
        groupsWithVisits += 1;
      } catch (error) {
        groupsFailedVisits.push(
          `${group.id}:${group.name}:${error instanceof Error ? error.message.split("\n")[0] ?? "fail" : "fail"}`,
        );
      }
      await sleep(200);
    }

    return { scheduleSessions, visitMarks, groupsWithVisits, groupsFailedVisits };
  }
}

function mapPayment(payment: CrmPayment, now: Date): Omit<CrmPaymentRecord, "_id" | "createdAt" | "updatedAt"> {
  return {
    crmId: payment.id,
    clientCrmId: emptyToNull(payment.client_id),
    clientName: emptyToNull(payment.client_name),
    purpose: payment.purpose,
    month: emptyToNull(payment.month),
    amountKopecks: Number(payment.amount) || 0,
    payTs: emptyToNull(payment.pay_ts),
    paid: payment.paid === "1" || payment.paid === "true",
    manual: payment.manual === "1" || payment.manual === "true",
    instructorCrmId: emptyToNull(payment.instructor_id),
    groupCrmId: emptyToNull(payment.group_id),
    branchCrmId: emptyToNull(payment.filial_id),
    email: emptyToNull(payment.email),
    phone: emptyToNull(payment.phone),
    description: emptyToNull(payment.description),
    acqOrder: emptyToNull(payment.acq_order),
    fiscalOrder: emptyToNull(payment.fiscal_order),
    creatorCrmId: emptyToNull(payment.creator_id),
    creatorName: emptyToNull(payment.creator_name),
    syncedAt: now,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
