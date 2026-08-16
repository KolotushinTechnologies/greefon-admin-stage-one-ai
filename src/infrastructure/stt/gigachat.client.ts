import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import { createSberFetch } from "./sber-fetch.js";

type OAuthToken = {
  accessToken: string;
  expiresAtMs: number;
};

export class GigaChatClient {
  private readonly fetchFn: typeof fetch;
  private token: OAuthToken | null = null;

  constructor(private readonly env: AppEnv) {
    this.fetchFn = createSberFetch(env.SBER_TLS_INSECURE);
  }

  get configured(): boolean {
    return this.env.SBER_AUTH_KEY.trim().length > 0;
  }

  async uploadFile(bytes: Buffer, filename: string, mime: string): Promise<string> {
    const token = await this.getAccessToken();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    form.append("purpose", "general");
    const response = await this.fetchFn(`${this.baseUrl()}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: form,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`GigaChat upload ${response.status}: ${summarizeError(payload)}`);
    }
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) {
      throw new Error("GigaChat upload: нет id файла.");
    }
    return id;
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      const token = await this.getAccessToken();
      await this.fetchFn(`${this.baseUrl()}/files/${encodeURIComponent(fileId)}/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch {
      // best-effort cleanup
    }
  }

  async chatWithAttachments(input: {
    content: string;
    attachments: string[];
    temperature?: number;
  }): Promise<string> {
    const token = await this.getAccessToken();
    const response = await this.fetchFn(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.env.SBER_MODEL,
        temperature: input.temperature ?? 0.1,
        // docs: attachments + function_call auto for file-aware generation
        function_call: "auto",
        messages: [
          {
            role: "user",
            content: input.content,
            attachments: input.attachments,
          },
        ],
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`GigaChat chat ${response.status}: ${summarizeError(payload)}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("GigaChat chat: пустой ответ.");
    }
    return content.trim();
  }

  private baseUrl(): string {
    return this.env.SBER_BASE_URL.replace(/\/+$/, "");
  }

  private async getAccessToken(): Promise<string> {
    if (!this.configured) {
      throw new Error("SBER_AUTH_KEY не задан.");
    }
    const now = Date.now();
    if (this.token && this.token.expiresAtMs - now > 60_000) {
      return this.token.accessToken;
    }
    const response = await this.fetchFn("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: randomUUID(),
        Authorization: `Basic ${this.env.SBER_AUTH_KEY.trim()}`,
      },
      body: new URLSearchParams({ scope: this.env.SBER_SCOPE.trim() || "GIGACHAT_API_PERS" }),
    });
    const payload = await readJson(response);
    if (!response.ok || typeof payload.access_token !== "string") {
      throw new Error(`Sber OAuth ${response.status}: ${summarizeError(payload)}`);
    }
    const expiresAtMs =
      typeof payload.expires_at === "number" && payload.expires_at > 1_000_000_000_000
        ? payload.expires_at
        : now + 25 * 60_000;
    this.token = { accessToken: payload.access_token, expiresAtMs };
    return payload.access_token;
  }
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function summarizeError(payload: any): string {
  if (typeof payload?.message === "string") {
    return payload.message;
  }
  if (typeof payload?.error === "string") {
    return payload.error;
  }
  try {
    return JSON.stringify(payload).slice(0, 240);
  } catch {
    return "ошибка";
  }
}
