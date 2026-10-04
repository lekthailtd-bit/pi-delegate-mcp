import assert from "node:assert/strict";
import { PiWorker } from "../dist/pi/worker.js";

let resolveIdle;
let callbackCalls = 0;
const session = {
  prompt: async () => {},
  waitForIdle: () => new Promise((resolve) => {
    resolveIdle = resolve;
  }),
};

const worker = new PiWorker({
  id: "settled-before-idle",
  cwd: process.cwd(),
  tools: [],
  callbackTarget: "supervisor",
  callback: {
    async deliver() {
      callbackCalls++;
    },
  },
});

worker.track(session, "Reply with the result");
await Promise.resolve();
assert.equal(worker.state, "running");

worker.onEvent({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text: "settled result" }] },
});
worker.onEvent({ type: "agent_settled" });
await Promise.resolve();
await Promise.resolve();

assert.equal(worker.state, "done", "agent_settled publishes terminal state immediately");
assert.equal(worker.lastText, "settled result");
assert.ok(worker.finishedAt);
assert.equal(callbackCalls, 1, "settlement sends one completion notification");

resolveIdle();
await worker.run;
assert.equal(callbackCalls, 1, "the prompt/idle completion path does not notify twice");

console.log("worker-lifecycle: ok");
