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

// Recovered model errors must not contaminate status or callback completion.
for (const settleEvent of [true, false]) {
  let release;
  const delivered=[];
  const retrySession={prompt:()=>new Promise(r=>{release=r}),waitForIdle:async()=>{}};
  const retry=new PiWorker({id:"retry-"+settleEvent,cwd:process.cwd(),tools:[],
    callbackTarget:"supervisor",callback:{async deliver(target,payload){delivered.push(payload)}}});
  retry.track(retrySession,"fixture");
  retry.onEvent({type:"message_end",message:{role:"assistant",content:[],stopReason:"error",errorMessage:"502 fixture"}});
  assert.equal(retry.error,"502 fixture");
  retry.onEvent({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"RECOVERED"}],stopReason:"stop"}});
  assert.equal(retry.error,undefined);
  if(settleEvent)retry.onEvent({type:"agent_settled"});
  release();await retry.run;
  assert.equal(retry.state,"done");
  assert.equal(retry.snapshot().error,undefined);
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].error,undefined);
  assert.equal(delivered[0].finalText,"RECOVERED");
}
for (const settleEvent of [true,false]) {
  let release;const delivered=[];
  const failure=new PiWorker({id:"failure-"+settleEvent,cwd:process.cwd(),tools:[],
    callbackTarget:"supervisor",callback:{async deliver(target,payload){delivered.push(payload)}}});
  failure.track({prompt:()=>new Promise(r=>{release=r}),waitForIdle:async()=>{}},"fixture");
  failure.onEvent({type:"message_end",message:{role:"assistant",content:[],stopReason:"error",errorMessage:"502 unrecovered"}});
  if(settleEvent)failure.onEvent({type:"agent_settled"});
  release();await failure.run;
  assert.equal(failure.state,"error");assert.equal(failure.error,"502 unrecovered");
  assert.equal(delivered.length,1);assert.equal(delivered[0].terminalState,"error");
  // Late success cannot erase a terminal error.
  failure.onEvent({type:"message_end",message:{role:"assistant",content:[],stopReason:"stop"}});
  assert.equal(failure.error,"502 unrecovered");
}
console.log("worker-retry-outcomes: ok");
