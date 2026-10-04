# Decision Ledger

## D001 — Integration-only live pi-delegate debug viewer
Status: accepted
Date: 2026-10-04

- Show request received by pi-delegate, prompt sent to the selected model endpoint, assistant response received, and final/error state.
- Integration environment only.
- Serve on localhost only and expose through the existing Cloudflare Access-protected 1MCP hostname at `/debug/pi-delegate`.
- In-memory ring buffer only. No database and no persistent debug log.
- Disabled unless `PI_DELEGATE_DEBUG_PORT` is explicitly set.
- Do not capture raw HTTP headers or credentials. Redact fields whose keys resemble authorization, cookies, API keys, tokens, or secrets.
- Plain HTML + JavaScript + SSE. View-only; clear only clears the browser screen.
- Rejected for v1: Grafana/Loki, persistent storage, WebSockets, React, a second public MCP hostname, direct public pi-delegate exposure, or provider HTTPS interception.

## D002 — Model retry outcome reflects the latest attempt
Status: accepted
Date: 2026-10-04

A successful assistant message clears the earlier model-attempt error while the worker is running. Settlement with an unresolved error ends as error; a recovered attempt ends as done. Historical debug events remain unchanged. Late messages cannot clear terminal timeout/abort errors. Both settlement paths and callback payloads are regression-tested. This narrow fix is based on the deployed live-debug-viewer branch; no unrelated protocol migration is included.

Posted by: Miles
Chat title: unavailable
Chat link: unavailable
