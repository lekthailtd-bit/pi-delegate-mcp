import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PKG_NAME, PKG_VERSION } from "./config.js";
import { registerEvents } from "./events/register.js";
import { registerTools } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: PKG_NAME, version: PKG_VERSION },
    {
      // `events` is the draft MCP Events capability understood by ChatGPT's modern MCP path.
      // The current v1 stdio SDK still negotiates the legacy era; Turn 3 migrates the serving
      // entry to MCP 2.0 rather than faking `server/discover` on the legacy transport.
      capabilities: { tools: {}, events: {} } as any,
      instructions:
        "Delegates work to the pi coding agent, keeping the delegate's context out of your own. " +
        "CRITICAL: call `init` before anything else, since the other tools refuse until you do. " +
        "It reports which models are reachable, which tools are permitted, and the recipes for " +
        "spawning, steering, and answering a delegate.",
    },
  );
  registerTools(server);
  registerEvents(server);
  return server;
}
