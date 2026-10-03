import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventService } from "../dist/events/service.js";
import { FileSubscriptionStore, canonicalJson, subscriptionId } from "../dist/events/store.js";
import { standardWebhookSignature } from "../dist/events/webhook.js";

const dir = await mkdtemp(join(tmpdir(), "pi-events-"));
const file = join(dir, "subscriptions.json");
const key = Buffer.alloc(32, 7);
const secret = `whsec_${key.toString("base64")}`;
const callbackUrl = "https://receiver.example/mcp-events/callback";
const posts = [];
const fakePost = async (url, body, headers) => {
  posts.push({ url, body, headers });
  const parsed = JSON.parse(body);
  if (parsed.type === "verification")
    return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
  return { status: 204, body: "" };
};
const options = {
  principal: "test-user",
  defaultTtlMs: 60_000,
  maxTtlMs: 120_000,
  verificationCacheMs: 60_000,
  secretRotationMs: 30_000,
  timeoutMs: 1_000,
  maxAttempts: 3,
  post: fakePost,
  sleep: async () => {},
};

assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.equal(
  subscriptionId("test-user", callbackUrl, "delegation.completed", {}),
  subscriptionId("test-user", callbackUrl, "delegation.completed", {}),
);

const service = new EventService(new FileSubscriptionStore(file), options);
const first = await service.subscribe({
  name: "delegation.completed",
  arguments: {},
  delivery: { mode: "webhook", url: callbackUrl, secret },
});
assert.match(first.id, /^sub_[0-9a-f]{32}$/);
assert.equal(posts.length, 1, "first subscription verifies callback");

const refreshed = await service.subscribe({
  name: "delegation.completed",
  arguments: {},
  delivery: { mode: "webhook", url: callbackUrl, secret },
});
assert.equal(refreshed.id, first.id, "subscription identity is idempotent");
assert.equal(posts.length, 1, "verification is cached for the same principal + URL");

const persisted = new FileSubscriptionStore(file);
assert.equal((await persisted.list()).length, 1, "subscription survives a fresh store instance");
const raw = await readFile(file, "utf8");
assert.ok(raw.includes(first.id));

const emitted = await service.emit(
  "delegation.completed",
  {
    sessionId: "job-1",
    terminalState: "done",
    resultHash: "abc",
    finishedAt: new Date().toISOString(),
  },
  { eventId: "evt_stable_test" },
);
assert.equal(emitted.event.eventId, "evt_stable_test");
assert.equal(emitted.deliveries.length, 1);
assert.equal(emitted.deliveries[0].accepted, true);
assert.equal(posts.at(-1).headers["webhook-id"], "evt_stable_test");

const ts = 1_700_000_000;
const sig = standardWebhookSignature("evt_1", ts, "{}", secret);
assert.match(sig, /^v1,[A-Za-z0-9+/]+=*$/);

await service.unsubscribe({
  name: "delegation.completed",
  arguments: {},
  delivery: { mode: "webhook", url: callbackUrl },
});
assert.equal((await persisted.list()).length, 0);
console.log("events: ok");
