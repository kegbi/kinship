# ADR 0004: Onboarding, Invitation, And Atomic Audit Coordination

- Status: accepted
- Date: 2026-08-12

## Context

First-user/workspace creation and invitation acceptance each cross identity,
workspace membership, and governance audit boundaries. The coordination must
preserve module ownership while making every required database effect atomic.

## Decision

A workspaces-owned, use-case-specific application service coordinates each flow.
It calls identity only through identity's public application facade. Every
participating module continues to own its writes and expose them through its
public application boundary.

The composition root registers governance audit handlers for the relevant
identity and workspace lifecycle events. It supplies those handlers and module
facades with the one transaction/session owned by the workspaces application
service; registration does not create a workspaces-to-governance dependency.

This boundary forbids a generic horizontal coordinator, a private adapter
import, and a direct cross-module table write.

## Atomicity And Success

The coordination is synchronous and transaction-scoped. Failure of an identity,
workspace, invitation or membership, or required governance audit effect
triggers all-or-nothing rollback. After every required effect, the coordinating
service verifies explicit success postconditions before commit. A missing or
failed postcondition also triggers rollback.

Transaction-scoped handlers are not durable asynchronous delivery. Any future
durable delivery mechanism requires its own accepted contract and executable
failure proof.

## Proof Boundary

FND-002 records this architecture decision; it does not implement or prove the
application behavior, rollback, or postconditions. The protected walking
skeleton and Slice 1 executable proof remain required before these mutation
flows are accepted.
