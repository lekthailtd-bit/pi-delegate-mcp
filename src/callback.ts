import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CallbackState, SessionState } from "./types.js";

export interface CompletionPayload {
  sessionId: string;
  label: string | undefined;
  terminalState: SessionState;
  finalText: string;
  error: string | undefined;
  startedAt: string;
  finishedAt: string;
  providerModel: string | undefined;
}

export interface CompletionCallback {
  deliver(target: string, payload: CompletionPayload, state: CallbackState): Promise<void>;
}

export function resultHash(payload: CompletionPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
export function deliveryId(sessionId: string, hash: string): string {
  return `pi-delegate:${sessionId}:${hash.slice(0, 24)}`;
}
const CHATGPT_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateChatGptCallbackTarget(target: string): string {
  if (!CHATGPT_CONVERSATION_ID.test(target)) throw new Error("callbackTarget must be an explicit ChatGPT conversation UUID");
  return target;
}
function textContent(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  return Array.isArray(content) ? content.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n") : "";
}
function callbackMessage(payload: CompletionPayload, state: CallbackState): string {
  return ["[delegated-worker-completion]", `delivery_id: ${state.deliveryId}`,
    `result_sha256: ${state.resultHash}`, JSON.stringify(payload, null, 2)].join("\n");
}
function completionUrl(base: string): URL {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/v1/chat/completions")) url.pathname = `${path}/v1/chat/completions`.replace(/^\/\//, "/");
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * Callback transport over the existing web-wrapper OpenAI-compatible provider.
 * Conversation delivery remains an internal adapter capability selected with the
 * non-standard `web_delivery` request extension; there is deliberately no /callback route.
 */
export class WebProviderCompletionCallback implements CompletionCallback {
  constructor(
    private readonly baseUrl: string,
    private readonly model = "chatgpt-web/gpt-5.6-sol",
    private readonly timeoutMs = 70000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(target: string, payload: CompletionPayload, state: CallbackState): Promise<void> {
    if (state.status === "delivered" || state.attempts > 0) return;
    state.attempts = 1;
    try {
      validateChatGptCallbackTarget(target);
      const response = await this.fetchImpl(completionUrl(this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: callbackMessage(payload, state) }],
          stream: false,
          web_delivery: { conversation_id: target, delivery_id: state.deliveryId },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`ChatGPT Web callback HTTP ${response.status}: ${raw.slice(0, 500)}`);
      let body: { web_delivery?: { status?: string; delivery_id?: string } };
      try { body = JSON.parse(raw) as typeof body; }
      catch { throw new Error("ChatGPT Web callback returned invalid JSON"); }
      if (body.web_delivery?.status !== "delivered" || body.web_delivery.delivery_id !== state.deliveryId) {
        throw new Error("ChatGPT Web callback response did not confirm the requested delivery identity");
      }
      state.status = "delivered";
      state.deliveredAt = new Date().toISOString();
      state.error = undefined;
    } catch (error) {
      // attempts=1 is intentionally retained. An ambiguous network timeout must not
      // cause pi-delegate to blindly submit the same callback again.
      state.status = "failed";
      state.error = error instanceof Error ? error.message : String(error);
    }
  }
}

/** Legacy MCP transport retained only behind an explicit opt-in for old deployments. */
export class McpCompletionCallback implements CompletionCallback {
  constructor(
    private readonly url: string,
    private readonly tool = "chat_completion",
    private readonly targetArg = "conversation_id",
    private readonly messageArg = "message",
    private readonly verifyTool?: string,
  ) {}
  private async client(): Promise<{ client: Client; transport: SSEClientTransport }> {
    const transport = new SSEClientTransport(new URL(this.url));
    const client = new Client({ name: "pi-delegate-callback", version: "1.0.0" });
    await client.connect(transport);
    return { client, transport };
  }
  private async verify(target: string, id: string): Promise<boolean> {
    if (!this.verifyTool) return false;
    const { client, transport } = await this.client();
    try {
      const result = await client.callTool({ name: this.verifyTool,
        arguments: { [this.targetArg]: target, offset: 0, limit: 500 } });
      return textContent(result).includes(id);
    } finally { await transport.close().catch(() => {}); }
  }
  async deliver(target: string, payload: CompletionPayload, state: CallbackState): Promise<void> {
    if (state.status === "delivered" || state.attempts > 0) return;
    state.attempts = 1;
    const { client, transport } = await this.client();
    try {
      await client.callTool({ name: this.tool, arguments: {
        [this.targetArg]: target, [this.messageArg]: callbackMessage(payload, state), model: "auto",
      }});
      state.status = "delivered"; state.deliveredAt = new Date().toISOString(); state.error = undefined;
    } catch (e) {
      const seen = await this.verify(target, state.deliveryId).catch(() => false);
      if (seen) {
        state.status = "delivered"; state.deliveredAt = new Date().toISOString(); state.error = undefined;
      } else {
        state.status = "failed"; state.error = e instanceof Error ? e.message : String(e);
      }
    } finally { await transport.close().catch(() => {}); }
  }
}

export function callbackFromEnv(): CompletionCallback | undefined {
  const webProvider = process.env.PI_DELEGATE_WEB_PROVIDER_URL;
  if (webProvider) {
    const timeout = Number(process.env.PI_DELEGATE_WEB_CALLBACK_TIMEOUT_MS || 70000);
    if (!Number.isFinite(timeout) || timeout < 1000) throw new Error("invalid PI_DELEGATE_WEB_CALLBACK_TIMEOUT_MS");
    return new WebProviderCompletionCallback(
      webProvider,
      process.env.PI_DELEGATE_WEB_CALLBACK_MODEL || "chatgpt-web/gpt-5.6-sol",
      timeout,
    );
  }
  // Web2API-era MCP delivery is disabled by default. It can only be used when a
  // deployment explicitly opts back into the legacy transport for rollback purposes.
  const url = process.env.PI_DELEGATE_CALLBACK_MCP_URL;
  if (!url || process.env.PI_DELEGATE_CALLBACK_LEGACY_MCP !== "true") return undefined;
  return new McpCompletionCallback(url,
    process.env.PI_DELEGATE_CALLBACK_MCP_TOOL || "chat_completion",
    process.env.PI_DELEGATE_CALLBACK_TARGET_ARG || "conversation_id",
    process.env.PI_DELEGATE_CALLBACK_MESSAGE_ARG || "message",
    process.env.PI_DELEGATE_CALLBACK_VERIFY_TOOL || undefined);
}
