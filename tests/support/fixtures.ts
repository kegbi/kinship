/**
 * Workspace content the integration suites reach through the public HTTP API
 * (GAP-035): people, their important dates, and the tag options a directory
 * filters by. Going through the API keeps every fixture on the owning
 * module's facade, audited exactly as a user's write would be.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { ApiSupport, WorkspaceSession } from "./api.ts";

/** A person's creation body; a bare string is a full given name. */
export type PersonInput = string | Readonly<Record<string, unknown>>;

/** Posts a person, returning the response untouched. */
export async function submitPerson(
  api: ApiSupport,
  session: WorkspaceSession,
  person: PersonInput,
  workspaceId = session.workspaceId,
): Promise<Response> {
  return await api.request(
    session,
    "/api/v1/people",
    "POST",
    typeof person === "string"
      ? { givenName: person, isPartial: false }
      : person,
    workspaceId,
  );
}

/** Creates a person and returns their id. */
export async function createPerson(
  api: ApiSupport,
  session: WorkspaceSession,
  person: PersonInput,
): Promise<string> {
  const response = await submitPerson(api, session, person);
  const body = await response.json() as {
    readonly person?: { readonly id: string };
  };
  assert(
    response.status === 201 && body.person,
    `person was not created: ${response.status}`,
  );
  return body.person.id;
}

/** Sends a request to a person's important dates, or to one of them. */
export async function importantDateRequest(
  api: ApiSupport,
  session: WorkspaceSession,
  personId: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: Readonly<Record<string, unknown>>,
  dateId?: string,
): Promise<Response> {
  return await api.request(
    session,
    `/api/v1/people/${personId}/dates${dateId ? `/${dateId}` : ""}`,
    method,
    body,
  );
}

/** Reads the workspace's person-tag options, optionally searched. */
export async function listTagOptions(
  api: ApiSupport,
  session: WorkspaceSession,
  query = "",
): Promise<Response> {
  return await api.request(
    session,
    `/api/v1/people/tag-options${query ? `?${query}` : ""}`,
  );
}
