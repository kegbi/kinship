# ADR 0005: Durable Reminder Delivery And Cadence Coordination

- Status: accepted
- Date: 2026-08-18

## Context

Reminder delivery crosses a database claim, an external provider effect, and a
later database commit. The v5 occurrence row could not durably represent lease
ownership, attempts, retry timing, ambiguous provider outcomes, reconciliation,
or manual attention. Stay-in-touch cadence also needs contact activity owned by
the interactions module without permitting a cross-module table write.

## Decision

Canonical schema v6 adds the minimum durable delivery state to
`reminder_occurrences`: claim token and owner, finite lease, attempt and retry
timestamps, stable provider idempotency key, receipt/result state, terminal
failure and manual-attention states, and due/lease indexes. `scheduled_job_runs`
remains observability only and is not a queue.

The first production provider is bounded `in_app`. Delivery is idempotent by the
occurrence/provider key. After an ambiguous timeout the worker reconciles; after
process death it safely repeats the same idempotent call. Claims use
`FOR UPDATE SKIP LOCKED`, provider calls run outside database transactions, and
finalization requires the current claim token. Email, SMTP, and webhooks are not
shipped by this decision.

Planning consumes `interactions.interaction-recorded` through public application
interfaces wired at the composition root. Interaction writes remain owned by
interactions and cadence writes remain owned by planning. A newer contact
updates `last_contacted_at` and calendar-derived `next_due_at` in the
interaction transaction; older and replayed events cannot regress or revise the
cadence.

## Proof Boundary

PLANNING-002 proves calendar/DST recurrence, tenant and archive authorization,
duplicate workers, finite-lease recovery, provider ambiguity, process death,
retry exhaustion, audit atomicity, and user-visible person/Today states. A
generic multi-workload supervisor, shutdown/metrics hardening, and additional
providers remain outside this decision and belong to later workload leaves.
