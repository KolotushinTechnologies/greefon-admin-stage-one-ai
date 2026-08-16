export type CrmStudentStatus =
  | "active"
  | "all_active"
  | "application"
  | "sampler"
  | "quarantine"
  | "week_skipped"
  | "leave"
  | "declined"
  | "unknown"
  | string;

export type CrmGuardian = {
  _id: string;
  crmId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  addName: string | null;
  addPhone: string | null;
  createTs: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmStudent = {
  _id: string;
  crmId: string;
  name: string;
  birthDate: string | null;
  gender: string | null;
  gup: string | null;
  weight: string | null;
  degree: string | null;
  passportSm: string | null;
  medCertificateDate: string | null;
  insuranceDate: string | null;
  status: CrmStudentStatus;
  inactive: boolean;
  lastVisit: string | null;
  lastComment: string | null;
  createTs: string | null;
  groupCrmId: string | null;
  branchCrmId: string | null;
  instructorCrmId: string | null;
  accountCrmId: string | null;
  accountName: string | null;
  accountPhone: string | null;
  accountEmail: string | null;
  accountAddName: string | null;
  accountAddPhone: string | null;
  branchName: string | null;
  groupName: string | null;
  instructorName: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmPaymentRecord = {
  _id: string;
  crmId: string;
  clientCrmId: string | null;
  clientName: string | null;
  purpose: string;
  month: string | null;
  amountKopecks: number;
  payTs: string | null;
  paid: boolean;
  manual: boolean;
  instructorCrmId: string | null;
  groupCrmId: string | null;
  branchCrmId: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  acqOrder: string | null;
  fiscalOrder: string | null;
  creatorCrmId: string | null;
  creatorName: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmScheduleSession = {
  _id: string;
  crmId: string;
  groupCrmId: string;
  raw: Record<string, unknown>;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmVisitMark = {
  _id: string;
  groupCrmId: string;
  clientCrmId: string;
  scheduleCrmId: string;
  value: string;
  clientName: string | null;
  clientStatus: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmCatalogEventKind = "comps" | "exams" | "camps";

export type CrmCatalogEvent = {
  _id: string;
  kind: CrmCatalogEventKind;
  crmId: string;
  name: string;
  dateStart: string | null;
  dateEnd: string | null;
  comment: string | null;
  creatorCrmId: string | null;
  padawans: number | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmImportReport = {
  at: string;
  org: { branches: number; instructors: number; groups: number };
  people: {
    students: number;
    guardians: number;
    expectedStudents: number | null;
    expectedGuardians: number | null;
  };
  ops: {
    paymentsTraining: number;
    paymentsOnline: number;
    scheduleSessions: number;
    visitMarks: number;
    groupsWithVisits: number;
    groupsFailedVisits: string[];
  };
  catalog: { comps: number; exams: number; camps: number };
  coverage: Array<{
    section: string;
    required: boolean;
    imported: boolean;
    count: number;
    notes: string;
  }>;
};
