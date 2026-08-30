import { env } from "../../../config/env.js";

export class AiProviderError extends Error {
  constructor(kind, message, details) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    if (details) this.details = details;
  }
}

const TIMEOUT_MS = 15_000;

/**
 * OpenAI-compatible chat completion. Never logs the API key.
 * Returns { content, model, latencyMs, raw }. Throws AiProviderError.
 */
export async function chatComplete({
  system,
  user,
  temperature = 0.2,
  maxTokens = 600,
  responseFormat = "json",
}) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    model: env.AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat === "json") body.response_format = { type: "json_object" };

  try {
    const res = await fetch(`${env.AI_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AiProviderError("http", `Provider returned ${res.status}`, {
        status: res.status,
        body: text.slice(0, 300),
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new AiProviderError("parse", "Provider response had no message content");

    return {
      content,
      model: data.model || env.AI_MODEL,
      latencyMs: Date.now() - t0,
      raw: data,
    };
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err?.name === "AbortError") {
      throw new AiProviderError("timeout", `Provider did not respond within ${TIMEOUT_MS}ms`);
    }
    throw new AiProviderError("network", err?.message || "network error");
  } finally {
    clearTimeout(timer);
  }
}
