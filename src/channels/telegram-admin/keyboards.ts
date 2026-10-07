import { InlineKeyboard, Keyboard } from "grammy";
import { hasAtLeast, type StaffRole } from "../../platform/identity/types.js";

export function mainMenuKeyboard(role: StaffRole): Keyboard {
  const keyboard = new Keyboard()
    .text("Расписание")
    .text("Чаты")
    .row()
    .text("Написать")
    .text("База знаний")
    .row()
    .text("Темы")
    .text("Филиалы");
  if (hasAtLeast(role, "admin")) {
    keyboard.row().text("События").text("Дела");
  }
  if (hasAtLeast(role, "superadmin")) {
    keyboard.row().text("Заметки").text("Штат");
  }
  keyboard.row().text("Меню");
  keyboard.resized().persistent();
  return keyboard;
}

export function parentLocationKeyboard(): Keyboard {
  return new Keyboard().requestLocation("Построить от меня").resized().oneTime();
}

export function confirmSendKeyboard(confirmationId: string): InlineKeyboard {
  return new InlineKeyboard().text("Отправить", `send:y:${confirmationId}`).text("Не надо", `send:n:${confirmationId}`);
}

/** Мультивыбор чатов для буфера рассылки. chatDocId = Mongo _id чата. */
export function broadcastPickerKeyboard(input: {
  chats: Array<{ id: string; title: string; selected: boolean }>;
  page: number;
  pageCount: number;
  selectedCount: number;
}): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text("Родительские", "bc:a:parents")
    .text("Тренерские", "bc:a:coaches")
    .row()
    .text("Все чаты", "bc:a:all")
    .text("Сбросить", "bc:x")
    .row();
  for (const chat of input.chats) {
    const mark = chat.selected ? "✓ " : "";
    const data = `bc:t:${input.page}:${chat.id}`;
    if (data.length > 64) {
      continue;
    }
    keyboard.text(clip(`${mark}${chat.title}`, 42), data).row();
  }
  const nav: Array<{ text: string; data: string }> = [];
  if (input.page > 0) {
    nav.push({ text: "←", data: `bc:p:${input.page - 1}` });
  }
  if (input.page + 1 < input.pageCount) {
    nav.push({ text: "→", data: `bc:p:${input.page + 1}` });
  }
  if (nav.length === 1 && nav[0]) {
    keyboard.text(nav[0].text, nav[0].data).row();
  } else if (nav.length > 1) {
    keyboard.text(nav[0]!.text, nav[0]!.data).text(nav[1]!.text, nav[1]!.data).row();
  }
  if (input.selectedCount > 0) {
    keyboard.text(`Отправить (${input.selectedCount})`, "bc:go").row();
  }
  return keyboard;
}

export function staffKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Кто в штате", "staff:list")
    .row()
    .text("Кто писал боту", "staff:visitors")
    .row()
    .text("Назначить по @username", "staff:assign:admin")
    .row()
    .text("Забрать по @username", "staff:revoke");
}

/** Карточка человека: роли кнопками. id = telegramUserId. */
export function staffUserCardKeyboard(input: {
  telegramUserId: string;
  role: StaffRole | null;
  isOwner: boolean;
  canRevoke: boolean;
}): InlineKeyboard {
  const id = input.telegramUserId;
  const keyboard = new InlineKeyboard();
  if (!input.isOwner) {
    if (input.role !== "admin") {
      keyboard.text("Сделать админом", `staff:role:admin:${id}`).row();
    }
    if (input.role !== "superadmin") {
      keyboard.text("Сделать суперадмином", `staff:role:super:${id}`).row();
    }
    if (input.canRevoke && input.role) {
      keyboard.text("Забрать доступ", `staff:rev:${id}`).row();
    }
  }
  keyboard.text("← К штату", "staff:menu");
  return keyboard;
}

export function knowledgeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Разделы базы", "kb:search")
    .row()
    .text("Добавить запись", "kb:add")
    .row()
    .text("Темы родителям", "kb:topics");
}

export function pageButtons(
  items: Array<{ text: string; data: string }>,
  nav: Array<{ text: string; data: string }> = [],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    if (item.data.length > 64) {
      continue;
    }
    keyboard.text(clip(item.text, 42), item.data).row();
  }
  if (nav.length === 1 && nav[0] && nav[0].data.length <= 64) {
    keyboard.text(nav[0].text, nav[0].data);
  } else if (nav.length > 1) {
    for (const [index, item] of nav.entries()) {
      if (item.data.length > 64) {
        continue;
      }
      keyboard.text(item.text, item.data);
      if (index % 2 === 1) {
        keyboard.row();
      }
    }
  }
  return keyboard;
}

export function orgKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Активные филиалы", "org:branches")
    .text("Тренеры", "org:instructors")
    .row()
    .text("Группы", "org:groups");
}

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export const MENU_COMMANDS = new Set([
  "меню",
  "расписание",
  "чаты",
  "написать",
  "база знаний",
  "темы",
  "филиалы",
  "события",
  "дела",
  "штат",
  "заметки",
]);
