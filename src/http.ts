#!/usr/bin/env node
import {
  HTTP_ALLOWED_HOSTS,
  HTTP_ALLOWED_ORIGINS,
  HTTP_BEARER_TOKEN,
  HTTP_HOST,
  HTTP_PATH,
  HTTP_PORT,
} from "./config.js";
import { createHttpServer } from "./http-server.js";
import { cleanup } from "./statusline/state.js";

if (!HTTP_BEARER_TOKEN) {
  throw new Error("PI_DELEGATE_HTTP_BEARER_TOKEN is required for the HTTP serving face");
}

const server = createHttpServer({
  bearerToken: HTTP_BEARER_TOKEN,
  path: HTTP_PATH,
  allowedHosts: HTTP_ALLOWED_HOSTS,
  allowedOrigins: HTTP_ALLOWED_ORIGINS,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
process.on("exit", cleanup);

server.listen(HTTP_PORT, HTTP_HOST, () => {
  process.stderr.write(`[pi-delegate] HTTP MCP listening on http://${HTTP_HOST}:${HTTP_PORT}${HTTP_PATH}\n`);
});
