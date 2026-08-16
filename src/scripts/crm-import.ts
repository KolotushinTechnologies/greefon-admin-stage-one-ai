import { loadEnv } from "../config/env.js";
import { buildContainer } from "../di/container.js";
import { ensureMongoIndexes } from "../infrastructure/mongo/indexes.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const container = buildContainer(env);
  const { mongo, redis, events, crmImport, crmOps } = container.cradle;

  await mongo.connect();
  await ensureMongoIndexes(mongo.getDb());
  await redis.ping();
  await events.connect();

  const skipVisits = process.argv.includes("--skip-visits");
  const visitsOnly = process.argv.includes("--visits-only");
  console.log(
    visitsOnly
      ? "CRM import visits-only…"
      : `CRM import start (visits=${skipVisits ? "off" : "on"})…`,
  );
  const report = visitsOnly
    ? await (async () => {
        const visits = await crmImport.importVisits();
        const coverage = await crmImport.coverageSnapshot();
        return {
          at: new Date().toISOString(),
          org: { branches: 0, instructors: 0, groups: 0 },
          people: { students: 0, guardians: 0, expectedStudents: null, expectedGuardians: null },
          ops: {
            paymentsTraining: 0,
            paymentsOnline: 0,
            scheduleSessions: visits.scheduleSessions,
            visitMarks: visits.visitMarks,
            groupsWithVisits: visits.groupsWithVisits,
            groupsFailedVisits: visits.groupsFailedVisits,
          },
          catalog: { comps: 0, exams: 0, camps: 0 },
          coverage,
        };
      })()
    : await crmImport.importAll({ includeVisits: !skipVisits });
  console.log(JSON.stringify(report, null, 2));
  if (visitsOnly) {
    await crmOps.saveImportReport(report);
  }

  const missing = report.coverage.filter((row) => row.required && !row.imported);
  if (missing.length > 0) {
    console.error(
      "Coverage gaps:",
      missing.map((row) => row.section).join(", "),
    );
    process.exitCode = 2;
  }

  await events.close();
  await mongo.close();
  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
