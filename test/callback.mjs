import assert from "node:assert/strict";
import { deliveryId, resultHash, validateChatGptCallbackTarget, WebProviderCompletionCallback } from "../dist/callback.js";
const payload = { sessionId:"job-1", label:"test", terminalState:"done", finalText:"ok",
  error:undefined, startedAt:"2026-01-01T00:00:00.000Z", finishedAt:"2026-01-01T00:00:01.000Z",
  providerModel:"test/model" };
const h1=resultHash(payload), h2=resultHash(payload);
assert.equal(h1,h2); assert.match(h1,/^[0-9a-f]{64}$/);
assert.equal(deliveryId("job-1",h1), `pi-delegate:job-1:${h1.slice(0,24)}`);

const target="6abedc37-27ac-83ed-bd7f-73f416e2dc3d";
assert.equal(validateChatGptCallbackTarget(target),target);
assert.throws(()=>validateChatGptCallbackTarget("active-tab"),/explicit ChatGPT conversation UUID/);
const state=()=>({status:"pending",target,deliveryId:deliveryId(payload.sessionId,h1),resultHash:h1,attempts:0,deliveredAt:undefined,error:undefined});
let calls=0,captured;
const successfulFetch=async(url,init)=>{
  calls++;captured={url:String(url),body:JSON.parse(init.body)};
  return new Response(JSON.stringify({web_delivery:{status:"delivered",delivery_id:captured.body.web_delivery.delivery_id}}),{status:200,headers:{"content-type":"application/json"}});
};
const callback=new WebProviderCompletionCallback("http://127.0.0.1:18081",undefined,5000,successfulFetch);
const delivered=state();await callback.deliver(target,payload,delivered);
assert.equal(delivered.status,"delivered");assert.equal(delivered.attempts,1);assert.equal(calls,1);
assert.equal(captured.url,"http://127.0.0.1:18081/v1/chat/completions");
assert.equal(captured.body.model,"chatgpt-web/gpt-5.6-sol");assert.equal(captured.body.web_delivery.conversation_id,target);assert.equal(captured.body.web_delivery.delivery_id,delivered.deliveryId);
assert.match(captured.body.messages[0].content,new RegExp(delivered.deliveryId.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));

await callback.deliver(target,payload,delivered);assert.equal(calls,1,"confirmed delivery retry does not resubmit");
const attempted=state();attempted.attempts=1;attempted.status="failed";await callback.deliver(target,payload,attempted);assert.equal(calls,1,"ambiguous prior attempt does not blindly resubmit");

let failedCalls=0;const failing=new WebProviderCompletionCallback("http://127.0.0.1:18081","chatgpt-web/gpt-5.6-sol",5000,async()=>{failedCalls++;return new Response("upstream down",{status:502})});const failed=state();await failing.deliver(target,payload,failed);assert.equal(failed.status,"failed");assert.equal(failed.attempts,1);assert.match(failed.error,/HTTP 502/);await failing.deliver(target,payload,failed);assert.equal(failedCalls,1,"failed attempted delivery remains non-retrying");

const malformed=state();await callback.deliver("not-a-conversation",payload,malformed);assert.equal(malformed.status,"failed");assert.equal(malformed.attempts,1);assert.match(malformed.error,/explicit ChatGPT conversation UUID/);assert.equal(calls,1,"malformed target never reaches provider");
console.log("callback: ok");
