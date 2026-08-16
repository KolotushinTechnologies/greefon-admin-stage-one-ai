import { isMasterKolotushin } from "./honorific.js";
import { MASTER_KOLOTUSHIN, type StaffUser } from "./types.js";

export function buildActorContext(user: StaffUser): string {
  const name = isMasterKolotushin(user)
    ? MASTER_KOLOTUSHIN
    : user.displayName ?? (user.username ? `@${user.username}` : "сотрудник");
  const lines = [
    "Собеседник этого хода:",
    `имя: ${name}`,
    `роль: ${user.role ?? "нет"}`,
    `telegram_id: ${user.telegramUserId}`,
  ];
  if (user.username) {
    lines.push(`username: @${user.username}`);
  }
  if (isMasterKolotushin(user)) {
    lines.push("тон: как со знакомым, на ты, без резюме и без должностных справок");
    lines.push("если спросил про себя — search_knowledge, две живые фразы, сразу к делу");
  }
  return lines.join("\n");
}
