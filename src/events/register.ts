import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  EVENTS_DEFAULT_TTL_MS,
  EVENTS_MAX_ATTEMPTS,
  EVENTS_MAX_TTL_MS,
  EVENTS_PRINCIPAL,
  EVENTS_SECRET_ROTATION_MS,
  EVENTS_STORE_FILE,
  EVENTS_TIMEOUT_MS,
  EVENTS_VERIFY_CACHE_MS,
} from "../config.js";
import { EventService } from "./service.js";
import { FileSubscriptionStore } from "./store.js";

const ListParams = z.object({
  cursor: z.string().nullable().optional(),
}).passthrough();

const SubscribeParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  delivery: z.object({ mode: z.literal("webhook"), url: z.string(), secret: z.string() }),
  cursor: z.string().nullable().optional(),
  ttlMs: z.number().positive().nullable().optional(),
});

const UnsubscribeParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  delivery: z.object({ mode: z.literal("webhook"), url: z.string() }),
});

const EventDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  delivery: z.array(z.literal("webhook")),
  inputSchema: z.record(z.string(), z.unknown()),
  payloadSchema: z.record(z.string(), z.unknown()),
});
const ListResult = z.object({
  events: z.array(EventDefinitionSchema),
  nextCursor: z.string().nullable(),
});
const SubscribeResult = z.object({
  id: z.string(),
  refreshBefore: z.string(),
  cursor: z.string().nullable(),
  truncated: z.boolean(),
});
const EmptyResult = z.object({}).strict();

let sharedService: EventService | undefined;

export function eventService(): EventService {
  return (sharedService ??= new EventService(new FileSubscriptionStore(EVENTS_STORE_FILE), {
    principal: EVENTS_PRINCIPAL,
    defaultTtlMs: EVENTS_DEFAULT_TTL_MS,
    maxTtlMs: EVENTS_MAX_TTL_MS,
    verificationCacheMs: EVENTS_VERIFY_CACHE_MS,
    secretRotationMs: EVENTS_SECRET_ROTATION_MS,
    timeoutMs: EVENTS_TIMEOUT_MS,
    maxAttempts: EVENTS_MAX_ATTEMPTS,
  }));
}

export function registerEvents(server: McpServer, service = eventService()): void {
  const lowLevel = server.server;
  lowLevel.setRequestHandler(
    "events/list",
    { params: ListParams, result: ListResult },
    async (params) => {
      const result = service.list(params.cursor);
      return {
        ...result,
        events: result.events.map((event) => ({ ...event, delivery: [...event.delivery] })),
      };
    },
  );
  lowLevel.setRequestHandler(
    "events/subscribe",
    { params: SubscribeParams, result: SubscribeResult },
    async (params) => service.subscribe(params),
  );
  lowLevel.setRequestHandler(
    "events/unsubscribe",
    { params: UnsubscribeParams, result: EmptyResult },
    async (params) => service.unsubscribe(params),
  );
}
