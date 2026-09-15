# Acceptance Criteria

These criteria are fixed before `EXP-002`. A criterion passes only when automated evidence exists, except where manual inspection is explicitly required.

## Workspace and core flow

- **AC-001:** A clean checkout succeeds with `npm ci` and `npm run check` under Node.js 24.21.0.
- **AC-002:** The web client creates a conversation, sends a message, renders ordered streamed deltas, and shows the completed assistant message.
- **AC-003:** The default provider produces byte-for-byte identical event payloads for identical normalized input without network access or credentials.
- **AC-004:** Shared runtime contracts validate every API body and SSE payload used by both API and web code.

## Persistence and consistency

- **AC-005:** Conversations, messages, responses, and events survive an API process restart using the same SQLite file.
- **AC-006:** Creating the user message and response record is atomic; an injected failure leaves neither partially created.
- **AC-007:** Message ordering remains deterministic when records have identical timestamps.
- **AC-008:** Duplicate identical `clientMessageId` requests return the original IDs and create no duplicate records or provider run.
- **AC-009:** Reusing a `clientMessageId` with different content returns a conflict and changes no stored state.

## Streaming and recovery

- **AC-010:** Each persisted stream has ordered integer event IDs, exactly one start event, zero or more deltas, and exactly one completed or failed terminal event.
- **AC-011:** Reconnecting with `Last-Event-ID` replays only later persisted events, in order and without duplicate text, then continues or closes correctly.
- **AC-012:** Missing, malformed, negative, and beyond-current `Last-Event-ID` cases have explicit automated coverage.
- **AC-013:** Refreshing during a response restores the selected conversation and resumes from the last applied event without duplicate messages or deltas.
- **AC-014:** Restarting the API preserves completed data and exposes an interrupted non-terminal response as recoverable rather than silently completed.
- **AC-015:** `GOV-004` demonstrates that a fresh Claude Code session can recover the implementation task from committed project artifacts; its evidence is recorded separately from product runtime recovery.

## Failure and retry

- **AC-016:** An injected provider failure persists and streams one safe failure event while retaining the user message and persisted partial response.
- **AC-017:** One retry can complete without duplicating the user message; repeated retry requests return the same replacement response.
- **AC-018:** Network disconnect, API error, validation error, and provider failure produce distinguishable accessible UI states with a usable next action.

## Safety and interface quality

- **AC-019:** Message validation covers whitespace-only, 4000-code-point, 4001-code-point, malformed body, and invalid identifier cases.
- **AC-020:** User and provider strings resembling HTML render as text and never execute or enter the DOM as raw HTML.
- **AC-021:** Client errors never expose stack traces, database statements, file paths, credentials, or full message content.
- **AC-022:** Keyboard-only use can create/select a conversation, send a message, observe status, and retry a failure.
- **AC-023:** CORS permits only the configured development web origin.

## Engineering evidence

- **AC-024:** Unit, API integration, SQLite/restart, SSE replay, and React component tests are present and pass.
- **AC-025:** Review output maps every requirement and acceptance criterion to implementation and test evidence.
- **AC-026:** Any missed requirement, manual correction, unexpected change, or deliberately deferred item is recorded in the experiment log.

## Completion rule

`EXP-002` is complete only when every criterion is marked passed with an evidence location, or explicitly marked failed with an explanation. Criteria must not be weakened after implementation begins; any necessary change must be recorded as a study deviation.
