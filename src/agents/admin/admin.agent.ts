import { ADMIN_SYSTEM_PROMPT } from "./prompt.js";
import { SUPERADMIN_CONSULTANT_PROMPT } from "./superadmin-prompt.js";
import { OS_ASSISTANT_PROMPT } from "./os-prompt.js";
import { buildOsTools } from "./os-tools.js";
import { buildAdminTools, toolsForRole } from "./tools.js";
import type { AgentRuntime } from "../../platform/agent-runtime/agent.runtime.js";
import type { AgentToolTrace } from "../../platform/agent-runtime/types.js";
import { buildActorContext } from "../../platform/identity/actor-context.js";
import type { StaffService } from "../../platform/identity/staff.service.js";
import type { ChatRepository } from "../../platform/org/chat.repository.js";
import type { OrgRepository } from "../../platform/org/org.repository.js";
import type { ScheduleService } from "../../platform/org/schedule.service.js";
import type { TargetResolver } from "../../platform/org/target-resolver.js";
import type { KnowledgeService } from "../../platform/knowledge/knowledge.service.js";
import type { KnowledgeGroundingService } from "../../platform/knowledge/knowledge-grounding.service.js";
import type { SendService } from "../../platform/messaging/send.service.js";
import type { ConversationStore } from "../../platform/conversation/conversation.store.js";
import type { StaffUser } from "../../platform/identity/types.js";
import type { SchoolEventService } from "../../platform/events/event.service.js";
import type { OsQueryService, GriffinBlock } from "../../platform/os-api/os.query.js";
import type { NotesService } from "../../platform/notes/notes.service.js";

export class AdminAgent {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly staff: StaffService,
    private readonly org: OrgRepository,
    private readonly chats: ChatRepository,
    private readonly resolver: TargetResolver,
    private readonly schedule: ScheduleService,
    private readonly knowledge: KnowledgeService,
    private readonly knowledgeGrounding: KnowledgeGroundingService,
    private readonly send: SendService,
    private readonly conversations: ConversationStore,
    private readonly schoolEvents: SchoolEventService,
    private readonly osQuery: OsQueryService,
    private readonly notes: NotesService,
  ) {}

  private adminToolsFor(role: NonNullable<StaffUser["role"]>) {
    return toolsForRole(
      buildAdminTools({
        staff: this.staff,
        org: this.org,
        chats: this.chats,
        resolver: this.resolver,
        schedule: this.schedule,
        knowledge: this.knowledge,
        knowledgeGrounding: this.knowledgeGrounding,
        send: this.send,
        conversations: this.conversations,
        schoolEvents: this.schoolEvents,
        notes: this.notes,
      }),
      role,
    );
  }

  private systemFor(role: NonNullable<StaffUser["role"]>): string {
    if (role === "superadmin") {
      return `${ADMIN_SYSTEM_PROMPT}\n\n${SUPERADMIN_CONSULTANT_PROMPT}`;
    }
    return ADMIN_SYSTEM_PROMPT;
  }

  async handlePrivateText(input: {
    telegramUserId: string;
    username: string | null;
    displayName: string | null;
    text: string;
    user: StaffUser;
  }): Promise<string> {
    const user = input.user;
    if (!user.role) {
      return "Привет. Это внутренний бот Грифон Админ, доступа у тебя пока нет. Если ты из штаба — пусть суперадмин добавит.";
    }

    const lowered = input.text.trim().toLowerCase();
    if (this.isConfirm(lowered)) {
      const pending = (await this.conversations.load(input.telegramUserId)).pendingSend;
      if (pending) {
        return this.send.confirmPending(input.telegramUserId, true);
      }
    }
    if (this.isCancel(lowered)) {
      const pending = (await this.conversations.load(input.telegramUserId)).pendingSend;
      if (pending) {
        return this.send.confirmPending(input.telegramUserId, false);
      }
    }

    const tools = this.adminToolsFor(user.role);

    const media = await this.conversations.getPendingMedia(input.telegramUserId);
    const mediaNote =
      media && media.media.length > 0
        ? `[В буфере рассылки ${media.media.length} вложени${media.media.length === 1 ? "е" : "я"} (${media.media.map((item) => item.kind).join(", ")})${media.caption ? `; подпись: ${media.caption}` : ""}]. При send_message они уйдут сами.\n\n`
        : "";

    const reply = await this.runtime.reply({
      system: this.systemFor(user.role),
      tools,
      ctx: {
        telegramUserId: input.telegramUserId,
        username: input.username,
        displayName: user.displayName,
        role: user.role,
        chatId: input.telegramUserId,
        lane: "admin",
      },
      userText: `${mediaNote}${input.text}`,
      actorContext: buildActorContext(user),
    });
    const roster = trainerRosterFromTools(reply.tools, input.text);
    return roster ?? reply.text;
  }

  async handleOsChat(input: {
    user: StaffUser;
    text: string;
    path?: string;
    branchCrmId?: string;
    history: Array<{ role: "user" | "assistant"; text: string }>;
  }): Promise<{ text: string; blocks: GriffinBlock[] }> {
    if (!input.user.role) {
      return { text: "Нет роли в штабе — сначала доступ в Telegram-боте.", blocks: [] };
    }

    const adminTools = this.adminToolsFor(input.user.role);
    const tools = [...buildOsTools(this.osQuery), ...adminTools];

    const screen = [
      input.path ? `Экран OS: ${input.path}` : null,
      input.branchCrmId ? `Скоуп филиала crmId=${input.branchCrmId}` : "Скоуп: все залы",
    ]
      .filter(Boolean)
      .join(". ");

    const consultant =
      input.user.role === "superadmin" ? `\n\n${SUPERADMIN_CONSULTANT_PROMPT}` : "";
    const reply = await this.runtime.replyEphemeral({
      system: `${OS_ASSISTANT_PROMPT}\n\n${screen}${consultant}`,
      tools,
      ctx: {
        telegramUserId: input.user.telegramUserId,
        username: input.user.username,
        displayName: input.user.displayName,
        role: input.user.role,
        lane: "os",
      },
      history: input.history,
      userText: input.text,
      actorContext: buildActorContext(input.user),
    });

    const insightTrace = reply.tools.find((item) => item.name === "get_os_insights");
    const blocks = insightTrace ? blocksFromInsights(insightTrace.result) : [];
    return { text: reply.text, blocks };
  }

  private isConfirm(text: string): boolean {
    return ["да", "ок", "хорошо", "отправляй", "шли", "подтверждаю", "давай", "+", "yes"].includes(text);
  }

  private isCancel(text: string): boolean {
    return ["нет", "не надо", "отмена", "стой", "не отправляй", "cancel", "стоп"].includes(text);
  }
}

/** Полный состав из инструмента — LLM иначе выкидывает «новых» людей вроде Иванова. */
function trainerRosterFromTools(tools: AgentToolTrace[], userText: string): string | null {
  const used = new Set(tools.map((item) => item.name));
  if (used.has("list_instructors")) {
    return rosterMessage(tools, "list_instructors");
  }
  if (!used.has("list_org") || !wantsTrainerRoster(userText)) {
    return null;
  }
  return rosterMessage(tools, "list_org");
}

function wantsTrainerRoster(text: string): boolean {
  const cleaned = text
    .replace(/\[с голоса\]/gi, " ")
    .replace(/\[подсказки Базы Знаний\][\s\S]*$/i, " ")
    .toLowerCase();
  return /(тренер|состав\s+школ)/i.test(cleaned);
}

function rosterMessage(tools: AgentToolTrace[], name: string): string | null {
  for (const item of [...tools].reverse()) {
    if (item.name !== name || !item.result || typeof item.result !== "object") {
      continue;
    }
    const row = item.result as { parent_message?: unknown; instructors_roster?: unknown };
    for (const key of ["parent_message", "instructors_roster"] as const) {
      const message = row[key];
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
    }
  }
  return null;
}

function blocksFromInsights(raw: unknown): GriffinBlock[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const data = raw as {
    probs?: GriffinBlock extends { type: "probs" } ? never : Array<{ id: string; label: string; p: number; note?: string }>;
    statusBars?: Array<{ id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" }>;
    proposals?: Array<{ id: string; title: string; detail: string }>;
  };
  const blocks: GriffinBlock[] = [];
  if (Array.isArray(data.probs) && data.probs.length > 0) {
    blocks.push({ type: "probs", title: "Вероятности", items: data.probs });
  }
  if (Array.isArray(data.statusBars) && data.statusBars.length > 0) {
    blocks.push({ type: "bars", title: "Состав статусов", items: data.statusBars });
  }
  if (Array.isArray(data.proposals) && data.proposals.length > 0) {
    blocks.push({ type: "actions", title: "Предложения ITF МФТ", items: data.proposals });
  }
  return blocks;
}
