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
| D008 | `delegation.completed` is the first event name. Turn 1 publishes its catalog definition; Turn 2 emits it for successful terminal results. | Stable event naming was tested independently before worker lifecycle integration. |
| D009 | The current server remains on the existing stdio/v1 MCP serving path through Turn 2. Full MCP 2.0 `2026-07-28` serving / `server/discover` and remote ChatGPT end-to-end transport are deferred to Turn 3. | Current dependency is `@modelcontextprotocol/sdk` v1.x and the binary directly connects `StdioServerTransport`; the official MCP v2 migration is a separate compatibility change. Do not fake modern discovery on the legacy transport. |
| D010 | Successful `done` completions use event-first delivery. The legacy explicit completion callback runs only when no matching event subscription accepts the event. `error` and `aborted` remain callback-only until separate event names are deliberately added. | Avoids duplicate supervisor notifications while retaining the proven callback fallback and keeping the Turn-2 event contract narrow. |
| D011 | The `delegation.completed` event ID is the existing deterministic logical completion ID derived from session ID + SHA-256 of the full completion payload. The event payload itself excludes `finalText`. | Retries and duplicate deliveries preserve identity while large worker output remains in authoritative session/durable state rather than webhook payloads. |
| D012 | Event/callback notification state belongs to one completed turn/result and is reset when `follow_up` begins a new turn. | A reused Pi session can produce multiple distinct results; each result needs its own deterministic completion notification instead of inheriting the prior turn's terminal notification state. |
| D013 | A successful webhook 2xx is recorded as event `accepted`, not `delivered`. | The webhook response proves acceptance by the receiver, not that a subscribed ChatGPT supervisor has completed downstream processing. |
| D014 | Notification transport failure must never make already-completed worker work reject retroactively. Event and callback failures are recorded as notification state and the terminal worker result remains intact. | Notification is secondary to durable work. A callback connection failure can occur before the adapter's internal delivery try/catch, so the orchestration layer must contain it. |

## Configurable operational defaults (inferred, not product decisions)

- Subscription lifetime default/max: 7 days, configurable by environment.
- Callback verification cache: 10 minutes.
- Secret rotation overlap: 5 minutes.
- Webhook timeout: 10 seconds.
- Delivery attempts: 4 maximum with bounded exponential backoff.

These defaults may be changed without revisiting the architecture, provided OpenAI MCP Events protocol constraints remain satisfied.
