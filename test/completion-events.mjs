import assert from "node:assert/strict";
import { notifyCompletion } from "../dist/completion.js";
import { deliveryId, resultHash } from "../dist/callback.js";

const payload = {
  sessionId: "job-42",
  label: "turn-2",
  terminalState: "done",
  finalText: "authoritative worker result",
  error: undefined,
  startedAt: "2026-10-03T20:00:00.000Z",
  finishedAt: "2026-10-03T20:01:00.000Z",
  providerModel: "test/model",
};
const hash = resultHash(payload);
const expectedId = deliveryId(payload.sessionId, hash);

let callbackCalls = 0;
const callback = {
  async deliver(_target, _payload, state) {
    callbackCalls++;
    state.attempts = 1;
    state.status = "delivered";
    state.deliveredAt = "2026-10-03T20:01:01.000Z";
  },
};

let eventCalls = 0;
let eventData;
const acceptingEvents = {
  async emit(name, data, options) {
    eventCalls++;
    eventData = data;
    assert.equal(name, "delegation.completed");
    assert.equal(options.eventId, expectedId);
    assert.equal(options.timestamp, payload.finishedAt);
    return {
      event: { eventId: options.eventId, name, timestamp: options.timestamp, data, cursor: null },
      deliveries: [{ subscriptionId: "sub_1", accepted: true, status: 204, attempts: 1 }],
    };
  },
};

const accepted = await notifyCompletion(payload, {
  events: acceptingEvents,
  callbackTarget: "supervisor-chat",
  callback,
});
assert.equal(eventCalls, 1);
assert.equal(callbackCalls, 1, "an explicit callbackTarget is delivered even when an event subscription accepts");
assert.equal(accepted.event.status, "accepted");
assert.equal(accepted.event.eventId, expectedId);
assert.equal(accepted.event.resultHash, hash);
assert.equal(accepted.event.acceptedSubscriptions, 1);
assert.equal(accepted.callback.status, "delivered");
assert.equal(accepted.callback.deliveryId, expectedId);
assert.equal(eventData.resultHash, hash);
assert.equal(eventData.sessionId, payload.sessionId);
assert.ok(!("finalText" in eventData), "large final text stays out of the event payload");
assert.ok(!JSON.stringify(eventData).includes(payload.finalText));

const noSubscribers = {
  async emit(name, data, options) {
    return {
      event: { eventId: options.eventId, name, timestamp: options.timestamp, data, cursor: null },
      deliveries: [],
    };
  },
};
const fallback = await notifyCompletion(payload, {
  events: noSubscribers,
  callbackTarget: "supervisor-chat",
  callback,
});
assert.equal(callbackCalls, 2);
assert.equal(fallback.event.status, "unsubscribed");
assert.equal(fallback.callback.status, "delivered");
assert.equal(fallback.callback.deliveryId, expectedId);

const rejectedEvents = {
  async emit(name, data, options) {
    return {
      event: { eventId: options.eventId, name, timestamp: options.timestamp, data, cursor: null },
      deliveries: [{ subscriptionId: "sub_bad", accepted: false, status: 503, attempts: 4, error: "HTTP 503" }],
    };
  },
};
const rejected = await notifyCompletion(payload, {
  events: rejectedEvents,
  callbackTarget: "supervisor-chat",
  callback,
});
assert.equal(callbackCalls, 3);
assert.equal(rejected.event.status, "failed");
assert.equal(rejected.event.attempts, 4);
assert.equal(rejected.callback.status, "delivered");

const errorPayload = { ...payload, terminalState: "error", error: "worker exploded" };
let errorEventCalls = 0;
const errorResult = await notifyCompletion(errorPayload, {
  events: { async emit() { errorEventCalls++; throw new Error("must not emit"); } },
  callbackTarget: "supervisor-chat",
  callback,
});
assert.equal(errorEventCalls, 0, "error states do not use delegation.completed");
assert.equal(callbackCalls, 4);
assert.equal(errorResult.event, undefined);
assert.equal(errorResult.callback.status, "delivered");

const throwingCallback = {
  async deliver() {
    throw new Error("callback connection refused");
  },
};
const contained = await notifyCompletion(payload, {
  events: noSubscribers,
  callbackTarget: "supervisor-chat",
  callback: throwingCallback,
});
assert.equal(contained.event.status, "unsubscribed");
assert.equal(contained.callback.status, "failed");
assert.equal(contained.callback.attempts, 1);
assert.equal(contained.callback.error, "callback connection refused");
assert.equal(payload.terminalState,"done","callback transport failure never mutates the successful delegate result");

const noTarget = await notifyCompletion(payload,{events:acceptingEvents,callback});
assert.equal(noTarget.callback,undefined,"callback target is never inferred");
assert.equal(callbackCalls,4);
assert.equal(noTarget.event.status,"accepted");

const repeat = await notifyCompletion(payload, { events: acceptingEvents });
assert.equal(repeat.event.eventId, expectedId, "the same logical result keeps the same event id");

console.log("completion-events: ok");
