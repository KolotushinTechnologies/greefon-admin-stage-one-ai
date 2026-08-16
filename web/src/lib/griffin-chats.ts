export type GriffinBlock =
  | { type: "bars"; title: string; items: Array<{ id: string; label: string; value: number; tone?: "accent" | "gold" | "ok" | "danger" }> }
  | { type: "probs"; title: string; items: Array<{ id: string; label: string; p: number; note?: string }> }
  | { type: "actions"; title: string; items: Array<{ id: string; title: string; detail: string }> };

export type GriffinMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: GriffinBlock[];
  at: number;
};

export type GriffinChat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: GriffinMessage[];
};

const PREFIX = "greefon-os-griffin-chats";

function key(userId: string): string {
  return `${PREFIX}:${userId || "anon"}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAll(userId: string): { activeId: string | null; chats: GriffinChat[] } {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) {
      return { activeId: null, chats: [] };
    }
    const parsed = JSON.parse(raw) as { activeId?: string | null; chats?: GriffinChat[] };
    return {
      activeId: parsed.activeId ?? null,
      chats: Array.isArray(parsed.chats) ? parsed.chats : [],
    };
  } catch {
    return { activeId: null, chats: [] };
  }
}

function writeAll(userId: string, state: { activeId: string | null; chats: GriffinChat[] }): void {
  localStorage.setItem(key(userId), JSON.stringify(state));
}

export function listGriffinChats(userId: string): GriffinChat[] {
  return readAll(userId).chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveGriffinChat(userId: string): GriffinChat | null {
  const state = readAll(userId);
  if (state.activeId) {
    return state.chats.find((chat) => chat.id === state.activeId) ?? null;
  }
  return state.chats[0] ?? null;
}

export function ensureGriffinChat(userId: string): GriffinChat {
  const existing = getActiveGriffinChat(userId);
  if (existing) {
    return existing;
  }
  return createGriffinChat(userId);
}

export function createGriffinChat(userId: string): GriffinChat {
  const chat: GriffinChat = {
    id: uid(),
    title: "Новый чат",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  const state = readAll(userId);
  writeAll(userId, { activeId: chat.id, chats: [chat, ...state.chats] });
  return chat;
}

export function setActiveGriffinChat(userId: string, chatId: string): GriffinChat | null {
  const state = readAll(userId);
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return null;
  }
  writeAll(userId, { ...state, activeId: chatId });
  return chat;
}

export function appendGriffinMessage(
  userId: string,
  chatId: string,
  message: Omit<GriffinMessage, "id" | "at"> & { id?: string; at?: number },
): GriffinChat | null {
  const state = readAll(userId);
  const index = state.chats.findIndex((item) => item.id === chatId);
  if (index < 0) {
    return null;
  }
  const chat = state.chats[index]!;
  const nextMessage: GriffinMessage = {
    id: message.id ?? uid(),
    role: message.role,
    text: message.text,
    ...(message.blocks ? { blocks: message.blocks } : {}),
    at: message.at ?? Date.now(),
  };
  const messages = [...chat.messages, nextMessage];
  const title =
    chat.messages.length === 0 && message.role === "user"
      ? message.text.trim().slice(0, 48) || chat.title
      : chat.title;
  const updated: GriffinChat = {
    ...chat,
    title,
    updatedAt: Date.now(),
    messages,
  };
  const chats = [...state.chats];
  chats[index] = updated;
  writeAll(userId, { activeId: chatId, chats });
  return updated;
}

export function deleteGriffinChat(userId: string, chatId: string): GriffinChat | null {
  const state = readAll(userId);
  const chats = state.chats.filter((item) => item.id !== chatId);
  if (chats.length === 0) {
    writeAll(userId, { activeId: null, chats: [] });
    return createGriffinChat(userId);
  }
  const activeId = state.activeId === chatId ? chats[0]!.id : state.activeId;
  writeAll(userId, { activeId, chats });
  return chats.find((item) => item.id === activeId) ?? chats[0]!;
}
