# pi-delegate-mcp decision ledger

Canonical scope: Lek Thai fork `lekthailtd-bit/pi-delegate-mcp` and its delegated-agent orchestration extensions.

## Settled decisions

| ID | Decision | Reason / evidence |
| --- | --- | --- |
| D001 | `lekthailtd-bit/pi-delegate-mcp` is the canonical fork for our orchestration changes. | The repository is our GitHub fork of `howznguyen/pi-delegate-mcp`; the operator confirmed we should extend our fork rather than upstream directly. |
| D002 | Completion work remains stacked on `feature/completion-callback` / PR #1 until reviewed. | That branch already provides deterministic result hashes, delivery IDs and a callback abstraction without changing stock behavior when unconfigured. |
| D003 | MCP Events rollout is split into three bounded turns. | Keeps each stage reviewable and leaves a working fallback after each stage. |
| D004 | Turn 1 adds the event catalog, subscribe/unsubscribe lifecycle, persistent subscription storage, signed webhook verification/delivery primitives and tests only. It does not wire worker completion to events. | Prevents event plumbing from being coupled to worker lifecycle changes before the transport is independently testable. |
| D005 | GitHub/durable result remains authoritative. An event is notification, never the only record of work. | Preserves recoverability across callback/event loss. |
| D006 | Subscription identity is deterministic over principal + callback URL + event name + canonical arguments. | Required for idempotent refresh and duplicate prevention. |
| D007 | Subscription secrets are stored only in the local state file, which is created with restrictive permissions; they must never be logged or written to GitHub. | Webhook signing secrets are credentials. |
| D008 | `delegation.completed` is the first event name. Turn 1 publishes its catalog definition but does not emit it; emission is Turn 2. | Stable event naming can be tested independently of the worker completion hook. |
| D009 | The current server remains on the existing stdio/v1 MCP serving path during Turn 1. Full MCP 2.0 `2026-07-28` serving / `server/discover` and remote ChatGPT end-to-end transport are deferred to Turn 3. | Current dependency is `@modelcontextprotocol/sdk` v1.x and the binary directly connects `StdioServerTransport`; the official MCP v2 migration is a separate compatibility change. Do not fake modern discovery on the legacy transport. |

## Configurable operational defaults (inferred, not product decisions)

- Subscription lifetime default/max: 7 days, configurable by environment.
- Callback verification cache: 10 minutes.
- Secret rotation overlap: 5 minutes.
- Webhook timeout: 10 seconds.
- Delivery attempts: 4 maximum with bounded exponential backoff.

These defaults may be changed without revisiting the architecture, provided OpenAI MCP Events protocol constraints remain satisfied.
