/**
 * What the MCP server tells an agent before it calls anything (MCP-C2).
 *
 * It lives beside the catalog so the guide, the generated catalog artefact,
 * and the endpoint state the same thing in the same words.
 */

export const AGENT_INSTRUCTIONS =
  "Kinship is a personal relationship manager: people and their profiles, relationships, notes and activities, tasks, reminders, a journal, and gifts and debts, in one workspace. Only the tools this token's scopes allow are listed, and the member's role can still refuse a call. Call get_context first to see the workspace, role, and scopes. Find a person's id with list_people or search_workspace before reading or writing about them. Read before you update: updates and deletes take expectedUpdatedAt or another revision from the matching list or get tool, and a stale one is refused as a conflict, so read again. On creates that take a requestId, pass your own UUID and reuse it when you retry; after what it made is deleted that requestId is refused, so use a new one. A refused call returns isError with the problem code and field messages; correct the arguments rather than retrying unchanged.";
