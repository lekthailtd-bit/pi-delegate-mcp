# pi-delegate decision ledger

## 2026-10-04 — Explicit ChatGPT callbacks use the single browser-backed web provider

Accepted architecture for restoring completion callbacks after Web2API was disabled:

- `callbackTarget` remains an explicit ChatGPT conversation UUID. It is never inferred from an active tab, prior session, or browser state.
- The callback transport is the existing browser-backed web-wrapper provider, invoked through its existing `POST /v1/chat/completions` boundary with `model=chatgpt-web/gpt-5.6-sol` and the internal `web_delivery` metadata extension. No new public `/callback` endpoint and no replacement daemon are introduced.
- `pi-delegate` keeps the existing deterministic completion identity: SHA-256 result hash plus `pi-delegate:<sessionId>:<hash-prefix>` delivery ID. The same delivery ID is included visibly in the callback message and passed to the browser adapter for duplicate suppression.
- A callback is attempted at most once from a given `CallbackState`. An ambiguous transport timeout leaves `attempts=1` and does not blindly resubmit. The browser provider itself verifies the visible message after its one submit attempt and treats a pre-existing matching delivery ID as delivered.
- An explicit `callbackTarget` is authoritative even when an MCP Event subscription also accepts `delegation.completed`; event acceptance no longer suppresses the explicitly requested conversation callback. This is a callback semantic change only, not an MCP Events redesign.
- Callback failure is recorded separately and must not change a successful delegate terminal state or discard the delegate result.
- Supervisor conversation callbacks never fall back to Gemini or OpenRouter. The callback request always names the ChatGPT Web model explicitly.
- The Web2API-era MCP callback transport remains in source only as an explicit rollback mechanism gated by `PI_DELEGATE_CALLBACK_LEGACY_MCP=true`; it is not selected by default merely because the old MCP URL environment variable exists.

Required deployment configuration for the new transport (not deployed by this change):

- `PI_DELEGATE_WEB_PROVIDER_URL=<base URL of the existing web-wrapper provider>`
- optional `PI_DELEGATE_WEB_CALLBACK_MODEL=chatgpt-web/gpt-5.6-sol`
- optional `PI_DELEGATE_WEB_CALLBACK_TIMEOUT_MS=70000`

Production readiness remains blocked on the live authenticated ChatGPT conversation callback acceptance test.

## Source Context
Posted by: Sam
Project: Agent delegation
Context date: 2026-10-04
