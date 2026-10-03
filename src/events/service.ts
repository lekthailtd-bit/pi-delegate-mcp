import { randomUUID } from "node:crypto";
import { EVENT_DEFINITIONS, eventDefinition, validateArguments } from "./catalog.js";
import { FileSubscriptionStore, subscriptionId, type SubscriptionRecord } from "./store.js";
import {
  decodeSigningSecret,
  sendEvent,
  verifyCallback,
  type EventEnvelope,
  type WebhookPost,
} from "./webhook.js";

export interface SubscribeRequest {
  name: string;
  arguments?: Record<string, unknown>;
  delivery: { mode: "webhook"; url: string; secret: string };
  cursor?: string | null;
  ttlMs?: number | null;
}

export interface UnsubscribeRequest {
  name: string;
  arguments?: Record<string, unknown>;
  delivery: { mode: "webhook"; url: string };
}

export interface EventServiceOptions {
  principal: string;
  defaultTtlMs: number;
  maxTtlMs: number;
  verificationCacheMs: number;
  secretRotationMs: number;
  timeoutMs: number;
  maxAttempts: number;
  post?: WebhookPost;
  sleep?: (ms: number) => Promise<void>;
}

export interface DeliveryResult {
  subscriptionId: string;
  accepted: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

export class EventService {
  private readonly verified = new Map<string, number>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(readonly store: FileSubscriptionStore, readonly options: EventServiceOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  list(cursor?: string | null) {
    if (cursor) return { events: [], nextCursor: null };
    return { events: EVENT_DEFINITIONS, nextCursor: null };
  }

  async subscribe(request: SubscribeRequest) {
    const args = request.arguments ?? {};
    if (!eventDefinition(request.name)) throw new Error(`Unknown event: ${request.name}`);
    validateArguments(request.name, args);
    if (request.delivery?.mode !== "webhook") throw new Error("only webhook delivery is supported");
    decodeSigningSecret(request.delivery.secret);

    const id = subscriptionId(this.options.principal, request.delivery.url, request.name, args);
    const cacheKey = `${this.options.principal}\n${request.delivery.url}`;
    if ((this.verified.get(cacheKey) ?? 0) <= Date.now()) {
      await verifyCallback(id, request.delivery.url, request.delivery.secret, this.options.timeoutMs, this.options.post);
      this.verified.set(cacheKey, Date.now() + this.options.verificationCacheMs);
    }

    const existing = await this.store.get(id);
    const now = new Date();
    const requestedTtl =
      request.ttlMs === null || request.ttlMs === undefined ? this.options.defaultTtlMs : request.ttlMs;
    if (!Number.isFinite(requestedTtl) || requestedTtl <= 0)
      throw new Error("ttlMs must be a positive number or null");
    const grantedTtl = Math.min(requestedTtl, this.options.maxTtlMs);
    const refreshBefore = new Date(now.getTime() + grantedTtl).toISOString();
    const secretChanged = Boolean(existing && existing.delivery.secret !== request.delivery.secret);
    const record: SubscriptionRecord = {
      id,
      principal: this.options.principal,
      name: request.name,
      arguments: args,
      delivery: request.delivery,
      ...(secretChanged
        ? {
            previousSecret: existing?.delivery.secret,
            previousSecretUntil: new Date(now.getTime() + this.options.secretRotationMs).toISOString(),
          }
        : existing?.previousSecret &&
            existing.previousSecretUntil &&
            Date.parse(existing.previousSecretUntil) > now.getTime()
          ? { previousSecret: existing.previousSecret, previousSecretUntil: existing.previousSecretUntil }
          : {}),
      cursor: null,
      refreshBefore,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.store.upsert(record);
    return { id, refreshBefore, cursor: null, truncated: false };
  }

  async unsubscribe(request: UnsubscribeRequest): Promise<Record<string, never>> {
    const args = request.arguments ?? {};
    if (request.delivery?.mode !== "webhook") throw new Error("only webhook delivery is supported");
    validateArguments(request.name, args);
    const id = subscriptionId(this.options.principal, request.delivery.url, request.name, args);
    await this.store.remove(id);
    return {};
  }

  async emit(
    name: string,
    data: Record<string, unknown>,
    options: { eventId?: string; timestamp?: string; cursor?: string | null } = {},
  ): Promise<{ event: EventEnvelope; deliveries: DeliveryResult[] }> {
    if (!eventDefinition(name)) throw new Error(`Unknown event: ${name}`);
    const event: EventEnvelope = {
      eventId: options.eventId ?? `evt_${randomUUID()}`,
      name,
      timestamp: options.timestamp ?? new Date().toISOString(),
      data,
      cursor: options.cursor ?? null,
    };
    const matching = (await this.store.active()).filter(
      (subscription) => subscription.name === name && this.matches(subscription, data),
    );
    const deliveries = await Promise.all(matching.map((subscription) => this.deliver(subscription, event)));
    return { event, deliveries };
  }

  private matches(subscription: SubscriptionRecord, data: Record<string, unknown>): boolean {
    return Object.entries(subscription.arguments).every(
      ([key, value]) => JSON.stringify(data[key]) === JSON.stringify(value),
    );
  }

  private async deliver(subscription: SubscriptionRecord, event: EventEnvelope): Promise<DeliveryResult> {
    let lastError: string | undefined;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        const response = await sendEvent(subscription, event, this.options.timeoutMs, this.options.post);
        lastStatus = response.status;
        if (response.status >= 200 && response.status < 300)
          return {
            subscriptionId: subscription.id,
            accepted: true,
            status: response.status,
            attempts: attempt,
          };
        if (
          response.status === 410 ||
          response.status === 413 ||
          (response.status >= 400 &&
            response.status < 500 &&
            response.status !== 408 &&
            response.status !== 425 &&
            response.status !== 429)
        )
          return {
            subscriptionId: subscription.id,
            accepted: false,
            status: response.status,
            attempts: attempt,
          };
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < this.options.maxAttempts) await this.sleep(250 * 4 ** (attempt - 1));
    }
    return {
      subscriptionId: subscription.id,
      accepted: false,
      status: lastStatus,
      attempts: this.options.maxAttempts,
      error: lastError,
    };
  }
}
