import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

const ListRequest = z.object({
  method: z.literal("events/list"),
  params: z.object({ cursor: z.string().nullable().optional() }).passthrough().optional(),
});

const SubscribeRequest = z.object({
  method: z.literal("events/subscribe"),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.literal("webhook"), url: z.string(), secret: z.string() }),
    cursor: z.string().nullable().optional(),
    ttlMs: z.number().positive().nullable().optional(),
  }),
});

const UnsubscribeRequest = z.object({
  method: z.literal("events/unsubscribe"),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    delivery: z.object({ mode: z.literal("webhook"), url: z.string() }),
  }),
});

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
  const lowLevel = server.server as any;
  lowLevel.setRequestHandler(ListRequest as any, async (request: any) => service.list(request.params?.cursor));
  lowLevel.setRequestHandler(SubscribeRequest as any, async (request: any) => service.subscribe(request.params));
  lowLevel.setRequestHandler(UnsubscribeRequest as any, async (request: any) => service.unsubscribe(request.params));
}
