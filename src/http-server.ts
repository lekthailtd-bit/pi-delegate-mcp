import { timingSafeEqual } from "node:crypto";
import { createServer as createNodeServer, type IncomingMessage, type Server as NodeServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer as createMcpServer } from "./server.js";

export interface HttpServerOptions {
  bearerToken: string;
  path?: string;
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hostname(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length);
}

/**
 * Node HTTP face for ChatGPT / remote MCP clients. The actual public HTTPS reverse proxy
 * is deliberately outside this process; this listener is safe to bind to loopback.
 */
export function createHttpServer(options: HttpServerOptions): NodeServer {
  if (!options.bearerToken) throw new Error("HTTP MCP requires a non-empty bearer token");
  const path = options.path ?? "/mcp";
  const allowedHosts = new Set((options.allowedHosts ?? ["127.0.0.1", "localhost"]).map((v) => v.toLowerCase()));
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const mcp = toNodeHandler(createMcpHandler(() => createMcpServer()));

  return createNodeServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== path) {
      response.writeHead(404).end();
      return;
    }

    const requestHost = hostname(request.headers.host);
    if (!requestHost || !allowedHosts.has(requestHost)) {
      response.writeHead(421, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "misdirected request" }));
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "origin not allowed" }));
      return;
    }
    const supplied = bearerToken(request);
    if (!supplied || !constantTimeEqual(supplied, options.bearerToken)) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="pi-delegate-mcp"',
      });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    await mcp(request, response);
  });
}
