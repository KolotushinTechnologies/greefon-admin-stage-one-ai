import type { GreefonVedomostiClient } from "../../infrastructure/crm-vedomosti/vedomosti.client.js";
import type { RabbitEventBus } from "../../infrastructure/rabbitmq/event-bus.js";
import { isClosedBranchName, maskToWeekdays } from "./types.js";
import type { OrgRepository } from "./org.repository.js";

export class CrmSyncService {
  constructor(
    private readonly crm: GreefonVedomostiClient,
    private readonly org: OrgRepository,
    private readonly events: RabbitEventBus,
  ) {}

  async sync(): Promise<{ branches: number; instructors: number; groups: number }> {
    if (!this.crm.enabled) {
      return { branches: 0, instructors: 0, groups: 0 };
    }

    const now = new Date();
    const [filials, instructors, groups] = await Promise.all([
      this.crm.listFilials(),
      this.crm.listInstructors(),
      this.crm.listGroups(),
    ]);

    const branchByCrm = new Map<string, string>();
    for (const filial of filials) {
      const saved = await this.org.upsertBranch({
        crmId: filial.id,
        name: filial.name,
        status: isClosedBranchName(filial.name) ? "closed" : "active",
        aliases: this.aliasesFor(filial.name),
        comment: filial.comment ?? null,
        syncedAt: now,
      });
      branchByCrm.set(filial.id, saved._id);
    }

    const instructorByCrm = new Map<string, string>();
    for (const instructor of instructors) {
      const saved = await this.org.upsertInstructor({
        crmId: instructor.id,
        name: instructor.name,
        comment: instructor.comment ?? null,
        syncedAt: now,
      });
      instructorByCrm.set(instructor.id, saved._id);
    }

    for (const group of groups) {
      const branchId = branchByCrm.get(group.filial_id);
      if (!branchId) {
        continue;
      }
      await this.org.upsertGroup({
        crmId: group.id,
        branchId,
        instructorId: group.instructor_id
          ? instructorByCrm.get(String(group.instructor_id)) ?? null
          : null,
        name: group.name,
        timeNote: group.comment ?? null,
        weekdays: group.schedule ? maskToWeekdays(group.schedule) : [],
        potential: group.potential === null || group.potential === undefined ? null : Number(group.potential),
        comment: group.comment ?? null,
        syncedAt: now,
      });
    }

    await this.events.publish("org.synced", {
      branches: filials.length,
      instructors: instructors.length,
      groups: groups.length,
    });

    return { branches: filials.length, instructors: instructors.length, groups: groups.length };
  }

  private aliasesFor(name: string): string[] {
    const aliases = new Set<string>();
    const cleaned = name.replace(/я\s*\(закрыто\)\s*/i, "").trim();
    aliases.add(cleaned);
    const street = cleaned.split(",")[0]?.trim();
    if (street) {
      aliases.add(street);
    }
    if (/дыбенко/i.test(name)) {
      aliases.add("дыбенко");
      aliases.add("дыбенко 8");
    }
    if (/байконур/i.test(name)) {
      aliases.add("байконурская");
    }
    if (/зв[её]здн/i.test(name)) {
      aliases.add("звездная");
    }
    if (/энгельс/i.test(name)) {
      aliases.add("энгельса");
    }
    if (/кузнечн/i.test(name)) {
      aliases.add("кузнечный");
    }
    if (/707/.test(name)) {
      aliases.add("школа 707");
    }
    if (/диплом/i.test(name)) {
      aliases.add("дипломат");
    }
    return [...aliases];
  }
}
