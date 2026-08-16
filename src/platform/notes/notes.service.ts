import { AccessDeniedError, DomainError, NotFoundError } from "../shared/errors.js";
import { hasAtLeast, type StaffUser } from "../identity/types.js";
import type { NotesRepository } from "./notes.repository.js";
import type { NoteStatus, SuperadminNote } from "./types.js";

export class NotesService {
  constructor(private readonly notesDocs: NotesRepository) {}

  private assertSuperadmin(actor: StaffUser): void {
    if (!actor.role || !hasAtLeast(actor.role, "superadmin")) {
      throw new AccessDeniedError("Заметки доступны только суперадмину.");
    }
  }

  async create(
    actor: StaffUser,
    input: { title: string; body: string; tags?: string[] },
  ): Promise<SuperadminNote> {
    this.assertSuperadmin(actor);
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length < 2) {
      throw new DomainError("Нужен заголовок заметки.", "VALIDATION");
    }
    if (body.length < 2) {
      throw new DomainError("Нужен текст заметки.", "VALIDATION");
    }
    return this.notesDocs.insert({
      title,
      body,
      tags: normalizeTags(input.tags),
      status: "active",
      createdByTelegramId: actor.telegramUserId,
      updatedByTelegramId: actor.telegramUserId,
    });
  }

  async list(actor: StaffUser, input: { status?: NoteStatus; limit?: number } = {}): Promise<SuperadminNote[]> {
    this.assertSuperadmin(actor);
    return this.notesDocs.list(input);
  }

  async get(actor: StaffUser, id: string): Promise<SuperadminNote> {
    this.assertSuperadmin(actor);
    const note = await this.notesDocs.findById(id);
    if (!note) {
      throw new NotFoundError("Заметка не найдена.");
    }
    return note;
  }

  async update(
    actor: StaffUser,
    id: string,
    patch: { title?: string; body?: string; tags?: string[] },
  ): Promise<SuperadminNote> {
    this.assertSuperadmin(actor);
    const existing = await this.notesDocs.findById(id);
    if (!existing || existing.status === "archived") {
      throw new NotFoundError("Заметка не найдена.");
    }
    const next = await this.notesDocs.update(id, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
      updatedByTelegramId: actor.telegramUserId,
    });
    if (!next) {
      throw new NotFoundError("Заметка не найдена.");
    }
    return next;
  }

  async archive(actor: StaffUser, id: string): Promise<SuperadminNote> {
    this.assertSuperadmin(actor);
    const existing = await this.notesDocs.findById(id);
    if (!existing) {
      throw new NotFoundError("Заметка не найдена.");
    }
    const next = await this.notesDocs.update(id, {
      status: "archived",
      updatedByTelegramId: actor.telegramUserId,
    });
    if (!next) {
      throw new NotFoundError("Заметка не найдена.");
    }
    return next;
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag.length < 2 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
    if (out.length >= 12) {
      break;
    }
  }
  return out;
}
