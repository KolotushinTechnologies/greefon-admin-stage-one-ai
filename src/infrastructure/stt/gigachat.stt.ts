import type { Bot } from "grammy";
import type { AppEnv } from "../../config/env.js";
import { alignTranscriptToEntities, buildGigaChatTranscribePrompt, type SttEntity } from "./stt-domain.js";
import { GigaChatClient } from "./gigachat.client.js";

export class GigaChatSttService {
  private readonly client: GigaChatClient;

  constructor(private readonly env: AppEnv) {
    this.client = new GigaChatClient(env);
  }

  get enabled(): boolean {
    return this.client.configured;
  }

  async transcribeTelegramFile(
    bot: Bot,
    fileId: string,
    options: { entities?: SttEntity[] } = {},
  ): Promise<{ text: string; raw: string }> {
    if (!this.enabled) {
      throw new Error("GigaChat STT не настроен (нужен SBER_AUTH_KEY).");
    }
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram не отдал путь к файлу.");
    }
    const url = `https://api.telegram.org/file/bot${this.env.TG_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Не скачал голос из Telegram (${response.status}).`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 256) {
      throw new Error("Файл слишком короткий.");
    }
    if (bytes.byteLength > 35 * 1024 * 1024) {
      throw new Error("Голосовое длиннее 35 МБ — сократи.");
    }

    // Telegram voice is usually .oga (Opus in Ogg). GigaChat rejects application/octet-stream —
    // OpenAPI accepts audio/x-ogg, audio/opus, audio/wav, …
    const upload = prepareUpload(file.file_path, bytes);
    const uploadedId = await this.client.uploadFile(bytes, upload.filename, upload.mime);
    try {
      const entities = options.entities ?? [];
      const rawAnswer = await this.client.chatWithAttachments({
        content: buildGigaChatTranscribePrompt(entities),
        attachments: [uploadedId],
        temperature: 0.1,
      });
      const cleaned = cleanTranscript(rawAnswer);
      if (cleaned.length < 2) {
        throw new Error("Не разобрал речь — попробуй ещё раз или напиши текстом.");
      }
      const text = alignTranscriptToEntities(cleaned, entities);
      return { text, raw: cleaned };
    } finally {
      await this.client.deleteFile(uploadedId);
    }
  }
}

/** MIME from GigaChat OpenAPI (`/files` audio table). */
function prepareUpload(filePath: string, bytes: Buffer): { filename: string; mime: string } {
  const ext = extensionFromPath(filePath);
  if (ext === "oga" || ext === "ogg" || looksLikeOgg(bytes)) {
    return { filename: "voice.ogg", mime: "audio/x-ogg" };
  }
  if (ext === "opus") {
    return { filename: "voice.opus", mime: "audio/opus" };
  }
  if (ext === "mp3") {
    return { filename: "voice.mp3", mime: "audio/mp3" };
  }
  if (ext === "wav") {
    return { filename: "voice.wav", mime: "audio/wav" };
  }
  if (ext === "m4a" || ext === "mp4") {
    return { filename: "voice.m4a", mime: "audio/x-m4a" };
  }
  if (ext === "webm" || ext === "weba") {
    return { filename: "voice.weba", mime: "audio/webm" };
  }
  // Safe default for Telegram voice containers
  return { filename: "voice.ogg", mime: "audio/x-ogg" };
}

function extensionFromPath(filePath: string): string {
  const base = filePath.split("/").pop() ?? "ogg";
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return "ogg";
  }
  return base.slice(dot + 1).toLowerCase() || "ogg";
}

function looksLikeOgg(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

function cleanTranscript(raw: string): string {
  return raw
    .replace(/^["«]|["»]$/g, "")
    .replace(/^Транскрипция:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
