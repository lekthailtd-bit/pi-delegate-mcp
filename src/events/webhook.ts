import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export interface WebhookResponse {
  status: number;
  body: string;
}

export type WebhookPost = (
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
) => Promise<WebhookResponse>;

interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

function ipv4Parts(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").map(Number);
}

export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) {
    const a = v4[0]!;
    const b = v4[1]!;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }

  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return false;
  if (
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  )
    return false;
  if (lower.startsWith("ff") || lower.startsWith("2001:db8:")) return false;
  if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7));
  return true;
}

export function decodeSigningSecret(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new Error("webhook secret must start with whsec_");
  const encoded = secret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("webhook secret is not valid base64");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 24 || key.length > 64) throw new Error("webhook secret must decode to 24-64 bytes");
  return key;
}

export function standardWebhookSignature(
  id: string,
  unixSeconds: number,
  body: string,
  secret: string,
): string {
  const key = decodeSigningSecret(secret);
  const signature = createHmac("sha256", key).update(`${id}.${unixSeconds}.${body}`).digest("base64");
  return `v1,${signature}`;
}

async function resolveTarget(rawUrl: string): Promise<ResolvedTarget> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("callback URL must use https");
  if (url.username || url.password) throw new Error("callback URL must not contain credentials");

  const literalFamily = isIP(url.hostname);
  if (literalFamily) {
    if (!isPublicAddress(url.hostname)) throw new Error("callback URL resolves to a non-public address");
    return { url, address: url.hostname, family: literalFamily as 4 | 6 };
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("callback URL did not resolve");
  if (addresses.some((entry) => !isPublicAddress(entry.address)))
    throw new Error("callback URL resolves to a non-public address");
  const first = addresses[0]!;
  return { url, address: first.address, family: first.family as 4 | 6 };
}

export const secureWebhookPost: WebhookPost = async (rawUrl, body, headers, timeoutMs) => {
  const target = await resolveTarget(rawUrl);
  return await new Promise<WebhookResponse>((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: target.address,
        family: target.family,
        port: target.url.port ? Number(target.url.port) : 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        servername: target.url.hostname,
        rejectUnauthorized: true,
        headers: {
          ...headers,
          Host: target.url.host,
          "Content-Length": String(Buffer.byteLength(body, "utf8")),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= 64 * 1024) chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("webhook timeout")));
    req.on("error", reject);
    req.end(body);
  });
};

function signedHeaders(
  id: string,
  body: string,
  secrets: string[],
  unixSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(unixSeconds),
    "webhook-signature": secrets.map((secret) => standardWebhookSignature(id, unixSeconds, body, secret)).join(" "),
  };
}

export async function verifyCallback(
  subscriptionId: string,
  url: string,
  secret: string,
  timeoutMs: number,
  post: WebhookPost = secureWebhookPost,
): Promise<void> {
  decodeSigningSecret(secret);
  const challenge = randomUUID();
  const id = `msg_verification_${randomUUID()}`;
  const body = JSON.stringify({ type: "verification", challenge });
  const response = await post(
    url,
    body,
    { ...signedHeaders(id, body, [secret]), "X-MCP-Subscription-Id": subscriptionId },
    timeoutMs,
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`callback verification returned HTTP ${response.status}`);
  let echoed = "";
  try {
    echoed = String((JSON.parse(response.body) as { challenge?: unknown }).challenge ?? "");
  } catch {
    throw new Error("callback verification returned invalid JSON");
  }
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(echoed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error("callback verification challenge mismatch");
}

export interface EventEnvelope {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
  cursor: string | null;
}

export async function sendEvent(
  subscription: {
    id: string;
    delivery: { url: string; secret: string };
    previousSecret?: string;
    previousSecretUntil?: string;
  },
  event: EventEnvelope,
  timeoutMs: number,
  post: WebhookPost = secureWebhookPost,
): Promise<WebhookResponse> {
  const body = JSON.stringify(event);
  if (Buffer.byteLength(body, "utf8") > 256 * 1024) throw new Error("event payload exceeds 256 KiB");
  const secrets = [subscription.delivery.secret];
  if (
    subscription.previousSecret &&
    subscription.previousSecretUntil &&
    Date.parse(subscription.previousSecretUntil) > Date.now()
  )
    secrets.push(subscription.previousSecret);
  return await post(
    subscription.delivery.url,
    body,
    { ...signedHeaders(event.eventId, body, secrets), "X-MCP-Subscription-Id": subscription.id },
    timeoutMs,
  );
}
