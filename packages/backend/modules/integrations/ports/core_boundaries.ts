/**
 * The two module boundaries a sync writes through.
 *
 * A synchronized card becomes a person and a synchronized to-do becomes a
 * task, but integrations owns neither table. Both contracts are declared here
 * and implemented at the composition root, which is what keeps this module
 * from importing people or planning at all — the checker proves it, and the
 * narrowness of these two interfaces is the reason it can.
 *
 * Both are deliberately idempotent at the create step: a remote object that is
 * seen twice arrives with the same request identifier, and the boundary is
 * expected to answer with the row it already made rather than a second one.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { ContactPayload, TaskPayload } from "../domain/dav_rules.ts";
import type { DavActor, DavTransaction } from "./context.ts";

export interface DavPeopleBoundary {
  ensure(
    actor: DavActor,
    input: ContactPayload & { readonly requestId: string },
    transaction: DavTransaction,
  ): Promise<
    | { readonly person: { readonly id: string }; readonly status: "ready" }
    | Failure<"forbidden", "idempotency-conflict" | "validation-error">
  >;
  update(
    actor: DavActor,
    personId: string,
    input: ContactPayload,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  archive(
    actor: DavActor,
    personId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  restore(
    actor: DavActor,
    personId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
}

export interface DavTaskBoundary {
  create(
    actor: DavActor,
    input: TaskPayload & { readonly requestId: string },
    transaction: DavTransaction,
  ): Promise<
    | { readonly status: "created"; readonly task: { readonly id: string } }
    | Failure<
      "archived-write-rejected" | "forbidden" | "not-found",
      "idempotency-conflict" | "stale" | "validation-error"
    >
  >;
  update(
    actor: DavActor,
    taskId: string,
    input: TaskPayload,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  complete(
    actor: DavActor,
    taskId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  reopen(
    actor: DavActor,
    taskId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
}
