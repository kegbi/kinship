/**
 * What a relationship is, and how each side of it reads.
 *
 * A relationship is one directed edge between two people, labelled twice: the
 * workspace's vocabulary gives it a forward label and a reverse one, so the
 * same row reads as "Mother" from one person and "Son" from the other. Which
 * label and which other person a reader sees is therefore a rule, not a query
 * — it depends only on whose profile the edge is being read from.
 *
 * The module owns `romantic_relationship_details` as well, but that table is a
 * storage concern of its adapters: no rule in this use case reads or writes a
 * romantic detail, and the record below carries none. Nothing beyond the
 * labelling above distinguishes a romantic edge from any other, so there is no
 * romantic rule to extract here.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { isInstant } from "../../../shared-kernel/validation.ts";

/** A relationship as the rules read it, with both labels resolved. */
export interface RelationshipRecord {
  readonly createdAt: string;
  readonly forwardLabel: string;
  readonly fromPersonId: string;
  readonly id: string;
  readonly relationshipTypeId: string;
  readonly relationshipTypeArchived: boolean;
  readonly reverseLabel: string;
  readonly status: "active" | "ended";
  readonly toPersonId: string;
  readonly updatedAt: string;
}

/**
 * The vocabulary entry an edge points at.
 *
 * The workspace owns the vocabulary, so this is the minimum a type has to say
 * for an edge to be created and labelled. Keeping it structural is what lets
 * these rules stay inside this module while the workspace's own record stays
 * authoritative.
 */
export interface RelationshipTypeOption {
  readonly archived: boolean;
  readonly forwardLabel: string;
  readonly id: string;
  readonly reverseLabel: string;
}

/** One side of an edge, as the person whose profile it is read from sees it. */
export interface RelationshipDisplay {
  readonly label: string;
  readonly name?: string;
  readonly personId: string;
  readonly relationshipId: string;
}

/** What a completed write says about the edge it created or changed. */
export interface RelationshipMutation {
  readonly affectedPersonIds: readonly [string, string];
  readonly forward: RelationshipDisplay;
  readonly inverse: RelationshipDisplay;
  readonly relationship: RelationshipRecord;
}

/**
 * How the edge reads from one person's side.
 *
 * Reading it from the person it points at flips both the label and the other
 * person, which is the whole of the inverse rule.
 */
export function displays(
  record: RelationshipRecord,
  personId: string,
  name?: string,
): RelationshipDisplay {
  const forward = record.fromPersonId === personId;
  return {
    label: forward ? record.forwardLabel : record.reverseLabel,
    ...(name ? { name } : {}),
    personId: forward ? record.toPersonId : record.fromPersonId,
    relationshipId: record.id,
  };
}

/**
 * The edge relabelled by the type it points at.
 *
 * A stored edge carries whatever labels it was written with; the workspace may
 * have renamed or archived the type since, so the vocabulary the caller just
 * read wins over the copy in the row.
 */
export function decorate(
  record: RelationshipRecord,
  type: RelationshipTypeOption,
): RelationshipRecord {
  return {
    ...record,
    forwardLabel: type.forwardLabel,
    relationshipTypeArchived: type.archived,
    reverseLabel: type.reverseLabel,
  };
}

/** Both sides of a finished write, with the two people it touched. */
export function success<T extends "created" | "existing" | "updated">(
  record: RelationshipRecord,
  status: T,
): RelationshipMutation & { readonly status: T } {
  return {
    affectedPersonIds: [record.fromPersonId, record.toPersonId] as const,
    forward: displays(record, record.fromPersonId),
    inverse: displays(record, record.toPersonId),
    relationship: record,
    status,
  };
}

/** Nobody is related to themselves, so the two endpoints must differ. */
export function validateEndpoints(
  sourcePersonId: string,
  targetPersonId: string,
): ValidationErrors {
  return sourcePersonId === targetPersonId
    ? { targetPersonId: "Choose another person." }
    : {};
}

/**
 * The revision a change or an unlink was composed against.
 *
 * The two messages differ because the member is doing two different things,
 * and the one they are told to refresh is the list they are looking at.
 */
export function validateRevision(
  expectedUpdatedAt: string,
  action: "save" | "unlink",
): ValidationErrors {
  if (isInstant(expectedUpdatedAt)) return {};
  return {
    expectedUpdatedAt: action === "save"
      ? "Refresh relationships before saving."
      : "Refresh relationships before unlinking.",
  };
}
