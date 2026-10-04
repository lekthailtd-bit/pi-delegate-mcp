import assert from "node:assert/strict";
import { once } from "node:events";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createHttpServer } from "../dist/http-server.js";

const token = "turn3-test-bearer-token";
const server = createHttpServer({ bearerToken: token });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const url = new URL(`http://127.0.0.1:${address.port}/mcp`);

try {
  const denied = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(denied.status, 401, "HTTP face must reject unauthenticated MCP traffic");

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "pi-delegate-turn3-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), "modern", "server/discover must negotiate the 2026-07-28 era");
  const discoverBody = {
    jsonrpc: "2.0",
    id: "discover-wire",
    method: "server/discover",
    params: { _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "wire-test", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } },
  };
  const discoverResponse = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
    },
    body: JSON.stringify(discoverBody),
  });
  assert.equal(discoverResponse.status, 200);
  const discover = await discoverResponse.json();
  assert.equal(discover.result.resultType, "complete");
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(discover.result.capabilities.events, {});

  const tools = await client.listTools();
  assert.equal(tools.tools.length, 12);
  const EventList = z.object({
    events: z.array(z.object({ name: z.string() }).passthrough()),
    nextCursor: z.string().nullable(),
  });
  const listed = await client.request({ method: "events/list", params: {} }, EventList);
  assert.deepEqual(listed.events.map((event) => event.name), ["delegation.completed"]);
  await client.close();
  console.log("http-modern: ok");
} finally {
  server.close();
  await once(server, "close");
}
