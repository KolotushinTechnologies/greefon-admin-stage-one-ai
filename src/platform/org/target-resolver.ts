import { AmbiguousTargetError, NotFoundError } from "../shared/errors.js";
import type { ChatRepository } from "./chat.repository.js";
import type { OrgRepository } from "./org.repository.js";
import { extractAgeHint, scoreTextMatch } from "./text-match.js";
import type { Branch, ChatAudience, ChatRecord, TrainingGroup } from "./types.js";

export type ResolveQuery = {
  raw?: string | undefined;
  branchHint?: string | undefined;
  groupHint?: string | undefined;
  audience?: ChatAudience | "all" | undefined;
  allBranches?: boolean | undefined;
  allChats?: boolean | undefined;
  includeClosed?: boolean | undefined;
};

export type ResolvedTarget = {
  chats: ChatRecord[];
  branch: Branch | null;
  group: TrainingGroup | null;
  summary: string;
  needsConfirmation: boolean;
};

export class TargetResolver {
  constructor(
    private readonly org: OrgRepository,
    private readonly chats: ChatRepository,
  ) {}

  async resolve(query: ResolveQuery): Promise<ResolvedTarget> {
    const branches = await this.org.listBranches(query.includeClosed === true);
    const groups = await this.org.listGroups();
    const chats = await this.chats.listAll();

    if (query.allChats) {
      const labeled = chats.filter((chat) => Boolean(chat.branchId) && chat.audience !== "unknown");
      if (labeled.length > 0) {
        return this.finish(labeled, null, null, "размеченные чаты");
      }
      if (chats.length > 0) {
        return this.finish(chats, null, null, "все известные чаты");
      }
      throw new NotFoundError("Чатов пока нет — добавь бота в группы.");
    }

    if (query.allBranches) {
      const activeIds = new Set(branches.filter((item) => item.status === "active").map((item) => item._id));
      const selected = chats.filter((chat) => chat.branchId && activeIds.has(chat.branchId) && chat.audience === "parents");
      if (selected.length === 0) {
        throw new NotFoundError("Родительских чатов активных филиалов не вижу. Разметь их или уточни аудиторию.");
      }
      return this.finish(selected, null, null, "родительские чаты активных филиалов");
    }

    // Явный чат по названию/label важнее филиала, который мог проскочить из текста объявления («собрание на Дыбенко»).
    const namedChat = this.uniqueNamedChat(chats, query);
    if (namedChat && !query.branchHint && !query.groupHint && !query.audience) {
      return this.finish([namedChat.chat], null, null, namedChat.chat.title);
    }

    const branchSource = query.branchHint ?? (namedChat ? undefined : query.raw);
    const branch = branchSource ? this.pickBranch(branches, branchSource) : null;
    const groupPool = branch ? groups.filter((item) => item.branchId === branch._id) : groups;
    const group = query.groupHint || (!namedChat && query.raw) ? this.pickGroup(groupPool, query.groupHint ?? query.raw ?? "", Boolean(query.groupHint)) : null;

    let selected = chats.slice();

    if (namedChat && (query.branchHint || query.groupHint || query.audience)) {
      selected = [namedChat.chat];
    }

    if (branch) {
      selected = selected.filter((chat) => chat.branchId === branch._id);
    }
    if (group) {
      const byGroup = selected.filter((chat) => chat.groupId === group._id);
      if (byGroup.length === 0) {
        throw new NotFoundError(
          `Группу «${group.name}» знаю, но чат к ней не привязан. Разметь чат или скажи, куда слать.`,
        );
      }
      selected = byGroup;
    }
    if (branch && !group && (!query.audience || query.audience === "all")) {
      const parents = selected.filter((chat) => chat.audience === "parents");
      if (parents.length > 0) {
        selected = parents;
      }
    }
    if (query.audience && query.audience !== "all") {
      selected = selected.filter((chat) => chat.audience === query.audience);
    }

    if (selected.length === 0 && (query.raw || query.branchHint || query.groupHint)) {
      selected = this.fuzzyChats(chats, query);
    }

    if (selected.length === 0 && namedChat) {
      selected = [namedChat.chat];
    }

    if (selected.length === 0) {
      throw new NotFoundError(this.missingMessage(branch, group, query));
    }

    if (this.isAmbiguous(selected, query, branch, group)) {
      const titles = selected.slice(0, 6).map((chat) => chat.title).join(", ");
      throw new AmbiguousTargetError(
        `Не уверен, куда слать. Нашёл: ${titles}${selected.length > 6 ? "…" : ""}. Уточни филиал, группу или аудиторию.`,
      );
    }

    const summary = this.describe(selected, branch, group, query);
    return this.finish(selected, branch, group, summary);
  }

  private finish(chats: ChatRecord[], branch: Branch | null, group: TrainingGroup | null, summary: string): ResolvedTarget {
    const unique = [...new Map(chats.map((chat) => [chat.telegramChatId, chat])).values()];
    return {
      chats: unique,
      branch,
      group,
      summary,
      needsConfirmation: unique.length > 1,
    };
  }

  /** Один чат, который явно назвали (title/labels), даже без разметки филиала. */
  private uniqueNamedChat(chats: ChatRecord[], query: ResolveQuery): { chat: ChatRecord; score: number } | null {
    const hint = (query.raw ?? "").trim();
    if (hint.length < 2) {
      return null;
    }
    const scored = chats
      .map((chat) => {
        const hay = `${chat.title} ${chat.labels.join(" ")}`;
        // hint может быть короткой («колтех») или длинной фразой — берём лучшее направление.
        const score = Math.max(scoreTextMatch(hay, hint), scoreTextMatch(hint, hay));
        return { chat, score };
      })
      .filter((item) => item.score >= 0.72)
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1];
    if (!top) {
      return null;
    }
    if (second && top.score - second.score < 0.08) {
      return null;
    }
    return top;
  }

  private pickBranch(branches: Branch[], hint: string): Branch | null {
    const scored = branches
      .map((branch) => ({
        branch,
        score: Math.max(scoreTextMatch(branch.name, hint), ...branch.aliases.map((alias) => scoreTextMatch(alias, hint))),
      }))
      .filter((item) => item.score >= 0.55)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return null;
    }
    const top = scored[0];
    const second = scored[1];
    if (!top) {
      return null;
    }
    if (second && top.score - second.score < 0.12 && top.branch.status === second.branch.status) {
      return null;
    }
    return top.branch;
  }

  private pickGroup(groups: TrainingGroup[], hint: string, strict: boolean): TrainingGroup | null {
    const age = extractAgeHint(hint);
    const scored = groups
      .map((group) => {
        const nameScore = scoreTextMatch(group.name, hint);
        const ageScore = age && group.name.includes(age) ? 0.9 : 0;
        return { group, score: Math.max(nameScore, ageScore) };
      })
      .filter((item) => item.score >= (strict ? 0.45 : 0.62))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return null;
    }
    const top = scored[0];
    const second = scored[1];
    if (!top) {
      return null;
    }
    if (second && top.score - second.score < 0.1) {
      return null;
    }
    return top.group;
  }

  private fuzzyChats(chats: ChatRecord[], query: ResolveQuery): ChatRecord[] {
    const raw = [query.raw, query.branchHint, query.groupHint].filter(Boolean).join(" ");
    return chats
      .map((chat) => {
        const hay = `${chat.title} ${chat.labels.join(" ")}`;
        return { chat, score: scoreTextMatch(hay, raw) };
      })
      .filter((item) => item.score >= 0.65)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.chat);
  }

  private isAmbiguous(selected: ChatRecord[], query: ResolveQuery, branch: Branch | null, group: TrainingGroup | null): boolean {
    if (selected.length <= 1) {
      return false;
    }
    if (query.allBranches || query.allChats) {
      return false;
    }
    if (group && selected.every((chat) => chat.groupId === group._id)) {
      return false;
    }
    if (branch && query.audience && query.audience !== "all" && selected.every((chat) => chat.branchId === branch._id && chat.audience === query.audience)) {
      return false;
    }
    const unlabeled = selected.filter((chat) => !chat.branchId && chat.audience === "unknown");
    if (unlabeled.length > 0 && !query.raw) {
      return true;
    }
    const distinctBranches = new Set(selected.map((chat) => chat.branchId ?? chat._id));
    return !branch && distinctBranches.size > 1;
  }

  private describe(chats: ChatRecord[], branch: Branch | null, group: TrainingGroup | null, query: ResolveQuery): string {
    if (query.allChats) {
      return `${chats.length} чатов`;
    }
    if (query.allBranches) {
      return `${chats.length} чатов филиалов`;
    }
    const parts = [`${chats.length} чат(ов)`];
    if (branch) {
      parts.push(branch.name);
    }
    if (group) {
      parts.push(group.name);
    }
    if (query.audience && query.audience !== "all") {
      parts.push(query.audience);
    }
    return parts.join(", ");
  }

  private missingMessage(branch: Branch | null, group: TrainingGroup | null, query: ResolveQuery): string {
    if (branch && group) {
      return `Филиал «${branch.name}» и группу «${group.name}» знаю, но чат к ним ещё не привязан. Разметь чат или уточни, куда слать.`;
    }
    if (branch) {
      return `Филиал «${branch.name}» есть, а размеченного чата под запрос не вижу.`;
    }
    if (query.raw) {
      return "Не понял, какой это чат или филиал. Назови филиал и группу, либо разметь чат.";
    }
    return "Не хватает филиала или чата.";
  }
}
