import { deliveryId, resultHash, type CompletionCallback, type CompletionPayload } from "./callback.js";
import type { EventService } from "./events/service.js";
import type { CallbackState, CompletionEventState } from "./types.js";

export interface CompletionNotificationOptions {
  events?: Pick<EventService, "emit"> | undefined;
  callbackTarget?: string | undefined;
  callback?: CompletionCallback | undefined;
}

export interface CompletionNotificationResult {
  event: CompletionEventState | undefined;
  callback: CallbackState | undefined;
}

/**
 * Notify a supervisor that one delegate turn reached a terminal state.
 *
 * Successful completions prefer MCP Events. The legacy explicit callback is a fallback
 * only when no event subscription accepts the event. Error/aborted states stay on the
 * callback path until their own event names are deliberately added to the catalog.
 */
export async function notifyCompletion(
  payload: CompletionPayload,
  options: CompletionNotificationOptions,
): Promise<CompletionNotificationResult> {
  const hash = resultHash(payload);
  const logicalId = deliveryId(payload.sessionId, hash);
  let event: CompletionEventState | undefined;

  if (payload.terminalState === "done" && options.events) {
    event = {
      status: "pending",
      eventId: logicalId,
      resultHash: hash,
      attempts: 0,
      subscriptions: 0,
      acceptedSubscriptions: 0,
      acceptedAt: undefined,
      error: undefined,
    };
    try {
      const emitted = await options.events.emit(
        "delegation.completed",
        {
          sessionId: payload.sessionId,
          label: payload.label ?? null,
          terminalState: "done",
          resultHash: hash,
          finishedAt: payload.finishedAt,
          providerModel: payload.providerModel ?? null,
        },
        { eventId: logicalId, timestamp: payload.finishedAt },
      );
      const accepted = emitted.deliveries.filter((delivery) => delivery.accepted).length;
      event.subscriptions = emitted.deliveries.length;
      event.acceptedSubscriptions = accepted;
      event.attempts = emitted.deliveries.reduce((sum, delivery) => sum + delivery.attempts, 0);
      if (accepted > 0) {
        event.status = "accepted";
        event.acceptedAt = new Date().toISOString();
        return { event, callback: undefined };
      }
      if (emitted.deliveries.length === 0) {
        event.status = "unsubscribed";
      } else {
        event.status = "failed";
        event.error = emitted.deliveries
          .map((delivery) => delivery.error ?? (delivery.status ? `HTTP ${delivery.status}` : "not accepted"))
          .join("; ");
      }
    } catch (error) {
      event.status = "failed";
      event.error = error instanceof Error ? error.message : String(error);
    }
  }

  if (!options.callbackTarget) return { event, callback: undefined };

  if (!options.callback) {
    return {
      event,
      callback: {
        status: "failed",
        target: options.callbackTarget,
        deliveryId: logicalId,
        resultHash: hash,
        attempts: 0,
        deliveredAt: undefined,
        error: "callback target supplied but no callback adapter is configured",
      },
    };
  }

  const callback: CallbackState = {
    status: "pending",
    target: options.callbackTarget,
    deliveryId: logicalId,
    resultHash: hash,
    attempts: 0,
    deliveredAt: undefined,
    error: undefined,
  };
  await options.callback.deliver(options.callbackTarget, payload, callback);
  return { event, callback };
}
