import https from "node:https";
import { URL } from "node:url";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Minimal fetch wrapper for Sber endpoints that often need corporate CA bypass.
 * Uses Node https.request so we don't depend on undici types.
 */
export function createSberFetch(tlsInsecure: boolean): typeof fetch {
  if (!tlsInsecure) {
    return fetch;
  }

  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.protocol !== "https:") {
      return fetch(input as any, init);
    }

    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = await normalizeBody(init.body, headers);

    return await new Promise<Response>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          agent: insecureAgent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === "string") {
                responseHeaders.set(key, value);
              } else if (Array.isArray(value)) {
                for (const item of value) {
                  responseHeaders.append(key, item);
                }
              }
            }
            resolve(
              new Response(buffer, {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage ?? "",
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }) as typeof fetch;
}

async function normalizeBody(
  body: RequestInit["body"],
  headers: Headers,
): Promise<Buffer | undefined> {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    return Buffer.from(body.toString());
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const request = new Request("https://local.invalid", { method: "POST", body });
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    return Buffer.from(await request.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  // ReadableStream / other — fallback via Request
  const request = new Request("https://local.invalid", { method: "POST", body });
  return Buffer.from(await request.arrayBuffer());
}
